import type { CaptureGroup, CaptureLayer, FlattenedTreeNode, LayerRect, TreeNode } from './types';

export type { TreeNode, FlattenedTreeNode };

/**
 * Calculates the rectangular intersection area between two layer rectangles.
 */
export function calculateIntersectionArea(r1: LayerRect, r2: LayerRect): number {
  const ix0 = Math.max(r1.x, r2.x);
  const iy0 = Math.max(r1.y, r2.y);
  const ix1 = Math.min(r1.x + r1.w, r2.x + r2.w);
  const iy1 = Math.min(r1.y + r1.h, r2.y + r2.h);
  const iw = Math.max(0, ix1 - ix0);
  const ih = Math.max(0, iy1 - iy0);
  return iw * ih;
}

/**
 * Checks whether a 2D point is contained inside a rectangle.
 */
export function isPointInsideRect(x: number, y: number, r: LayerRect): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/**
 * Pure helper to test if a candidate layer is a captured child of a container layer.
 * Rules:
 * - Candidate must be a zap layer (excludes background).
 * - Parent must be a zap layer.
 * - Candidate cannot be the parent itself.
 * - Candidate surface area must be strictly smaller than the parent area.
 * - Candidate center is inside parent OR candidate area intersection is >= 85%.
 * - No naive `child.order > parent.order` constraint.
 */
export function isChildLayer(
  candidate: Pick<CaptureLayer, 'id' | 'role' | 'rect'>,
  parent: Pick<CaptureLayer, 'id' | 'role' | 'rect'>,
): boolean {
  if (candidate.role !== 'zap') return false;
  if (parent.role !== 'zap') return false;
  if (candidate.id === parent.id) return false;

  const c = candidate.rect;
  const p = parent.rect;

  const candidateArea = c.w * c.h;
  const parentArea = p.w * p.h;

  if (candidateArea >= parentArea || candidateArea <= 0 || parentArea <= 0) {
    return false;
  }

  const cx = c.x + c.w / 2;
  const cy = c.y + c.h / 2;
  if (isPointInsideRect(cx, cy, p)) {
    return true;
  }

  const intersection = calculateIntersectionArea(c, p);
  const ratio = intersection / candidateArea;
  return ratio >= 0.85 - 1e-6;
}

/**
 * Deterministic reading order comparator:
 * Top-to-bottom (y), then left-to-right (x), with fallback to layer order.
 */
export function compareReadingOrder(
  a: { rect: LayerRect; order: number },
  b: { rect: LayerRect; order: number },
): number {
  const dy = a.rect.y - b.rect.y;
  if (Math.abs(dy) > 1e-4) {
    return dy;
  }
  const dx = a.rect.x - b.rect.x;
  if (Math.abs(dx) > 1e-4) {
    return dx;
  }
  return a.order - b.order;
}

/**
 * Detects all captured children of a container among the provided layers,
 * returning them in deterministic reading order.
 */
export function findContainerChildren(
  parent: CaptureLayer,
  layers: CaptureLayer[],
): CaptureLayer[] {
  if (parent.role !== 'zap') return [];
  return layers
    .filter((layer) => isChildLayer(layer, parent))
    .sort(compareReadingOrder);
}

/**
 * Finds the group where the layer is the parent.
 */
export function findGroupByParentId(
  groups: CaptureGroup[] | undefined,
  parentId: string,
): CaptureGroup | undefined {
  return groups?.find((g) => g.parentId === parentId);
}

/**
 * Finds the group containing the given layer as a child.
 */
export function findGroupByChildId(
  groups: CaptureGroup[] | undefined,
  childId: string,
): CaptureGroup | undefined {
  return groups?.find((g) => g.childIds.includes(childId));
}

/**
 * Pure helper to automatically infer flat, deterministic capture groups from layers.
 * Policy:
 * - Consider zap layers ordered from largest surface area to smallest, then order/id.
 * - A layer can only be claimed once across all groups (either as parent or child).
 * - A layer already claimed as a child cannot become a parent.
 * - Groups are strictly flat (not nested).
 * - Produce only groups with at least one child.
 * - Deterministic collision-free group IDs, ideally based on stableId, falling back to id.
 */
export function inferCaptureGroups(layers: CaptureLayer[]): CaptureGroup[] {
  const zapLayers = layers.filter((l) => l.role === 'zap');
  if (zapLayers.length === 0) return [];

  // Sort candidate parents: largest area first, then order, then id
  const sortedCandidates = [...zapLayers].sort((a, b) => {
    const areaA = a.rect.w * a.rect.h;
    const areaB = b.rect.w * b.rect.h;
    if (Math.abs(areaB - areaA) > 1e-4) {
      return areaB - areaA;
    }
    if (a.order !== b.order) {
      return a.order - b.order;
    }
    return a.id.localeCompare(b.id);
  });

  const claimedLayerIds = new Set<string>();
  const groups: CaptureGroup[] = [];
  const usedGroupIds = new Set<string>();

  for (const parent of sortedCandidates) {
    if (claimedLayerIds.has(parent.id)) {
      continue;
    }

    // Find children using findContainerChildren, excluding already claimed layers
    const allChildren = findContainerChildren(parent, zapLayers);
    const availableChildren = allChildren.filter(
      (c) => c.id !== parent.id && !claimedLayerIds.has(c.id),
    );

    if (availableChildren.length === 0) {
      continue;
    }

    // Deterministic collision-free ID
    const baseId = `group-${parent.stableId ?? parent.id}`;
    let groupId = baseId;
    let suffix = 2;
    while (usedGroupIds.has(groupId)) {
      groupId = `${baseId}-${suffix++}`;
    }
    usedGroupIds.add(groupId);

    const childIds = availableChildren.map((c) => c.id);

    // Claim parent and all children
    claimedLayerIds.add(parent.id);
    for (const cid of childIds) {
      claimedLayerIds.add(cid);
    }

    groups.push({
      id: groupId,
      parentId: parent.id,
      childIds,
    });
  }

  return sanitizeGroups(groups, layers);
}

/**
 * Returns the parent layer ID of the given layer, or null if root / unparented.
 */
export function parentOfLayer(
  groups: CaptureGroup[] | undefined,
  layerId: string,
): string | null {
  if (!groups) return null;
  for (const g of groups) {
    if (g.childIds.includes(layerId)) {
      return g.parentId;
    }
  }
  return null;
}

/**
 * Returns direct children IDs of the layer in childIds order.
 */
export function childrenOfLayer(
  groups: CaptureGroup[] | undefined,
  layerId: string,
): string[] {
  if (!groups) return [];
  const g = groups.find((group) => group.parentId === layerId);
  return g ? [...g.childIds] : [];
}

/**
 * Returns ancestors of the layer, from direct parent toward root.
 */
export function ancestorsOfLayer(
  groups: CaptureGroup[] | undefined,
  layerId: string,
): string[] {
  if (!groups) return [];
  const ancestors: string[] = [];
  const visited = new Set<string>([layerId]);
  let current = parentOfLayer(groups, layerId);
  while (current !== null && !visited.has(current)) {
    visited.add(current);
    ancestors.push(current);
    current = parentOfLayer(groups, current);
  }
  return ancestors;
}

/**
 * Returns all descendants of the layer in depth-first order.
 */
export function descendantsOfLayer(
  groups: CaptureGroup[] | undefined,
  layerId: string,
): string[] {
  if (!groups) return [];
  const descendants: string[] = [];
  const visited = new Set<string>([layerId]);

  function dfs(currId: string) {
    const children = childrenOfLayer(groups, currId);
    for (const childId of children) {
      if (!visited.has(childId)) {
        visited.add(childId);
        descendants.push(childId);
        dfs(childId);
      }
    }
  }

  dfs(layerId);
  return descendants;
}

/**
 * Checks if ancestorId is an ancestor of layerId.
 */
export function isAncestorOf(
  groups: CaptureGroup[] | undefined,
  ancestorId: string,
  layerId: string,
): boolean {
  return ancestorsOfLayer(groups, layerId).includes(ancestorId);
}

/**
 * Returns depth of a layer (0 for root layers without parent).
 */
export function depthOfLayer(
  groups: CaptureGroup[] | undefined,
  layerId: string,
): number {
  return ancestorsOfLayer(groups, layerId).length;
}

/**
 * Sanitizes groups against layers enforcing invariants:
 * - Each layer is child of at most one group
 * - Each parent layer has at most one group
 * - parent != child
 * - No cycles
 * - Only role === 'zap' layers participate
 * - Empty groups are removed
 */
export function sanitizeGroups(
  groups: CaptureGroup[] | undefined,
  layers: CaptureLayer[],
): CaptureGroup[] {
  if (!groups || groups.length === 0) return [];

  const zapMap = new Map<string, CaptureLayer>();
  for (const l of layers) {
    if (l.role === 'zap') {
      zapMap.set(l.id, l);
    }
  }

  // Merge multiple groups with the same parentId while preserving order of first appearance
  const groupsByParent = new Map<string, { id: string; childIds: string[] }>();
  for (const g of groups) {
    if (!zapMap.has(g.parentId)) continue;
    const existing = groupsByParent.get(g.parentId);
    if (existing) {
      for (const cid of g.childIds) {
        if (!existing.childIds.includes(cid)) {
          existing.childIds.push(cid);
        }
      }
    } else {
      groupsByParent.set(g.parentId, {
        id: g.id,
        childIds: [...g.childIds],
      });
    }
  }

  const parentOf = new Map<string, string>(); // childId -> parentId
  const sanitizedGroups: CaptureGroup[] = [];
  const usedGroupIds = new Set<string>();

  for (const [parentId, groupData] of groupsByParent) {
    const validChildren: string[] = [];

    for (const childId of groupData.childIds) {
      if (childId === parentId) continue;
      if (!zapMap.has(childId)) continue;
      if (parentOf.has(childId)) continue;

      // Cycle check: verify parentId does not descend from childId
      let curr: string | undefined = parentId;
      let cycle = false;
      while (curr !== undefined) {
        if (curr === childId) {
          cycle = true;
          break;
        }
        curr = parentOf.get(curr);
      }
      if (cycle) continue;

      parentOf.set(childId, parentId);
      validChildren.push(childId);
    }

    if (validChildren.length > 0) {
      const parentLayer = zapMap.get(parentId);
      const baseId = groupData.id || `group-${parentLayer?.stableId ?? parentId}`;
      let groupId = baseId;
      let suffix = 2;
      while (usedGroupIds.has(groupId)) {
        groupId = `${baseId}-${suffix++}`;
      }
      usedGroupIds.add(groupId);

      sanitizedGroups.push({
        id: groupId,
        parentId,
        childIds: validChildren,
      });
    }
  }

  return sanitizedGroups;
}

/**
 * Moves layerId under parentId (or to root if parentId is null) at optional index.
 * Refuses if parentId is layerId itself, a descendant, or invalid zap layers.
 */
export function setLayerParent(
  groups: CaptureGroup[] | undefined,
  layers: CaptureLayer[],
  layerId: string,
  parentId: string | null,
  index?: number,
): CaptureGroup[] {
  const current = sanitizeGroups(groups, layers);

  const childLayer = layers.find((l) => l.id === layerId && l.role === 'zap');
  if (!childLayer) return current;

  if (parentId !== null) {
    if (parentId === layerId) return current;
    const parentLayer = layers.find((l) => l.id === parentId && l.role === 'zap');
    if (!parentLayer) return current;

    // Check if parentId is a descendant of layerId
    const descendants = descendantsOfLayer(current, layerId);
    if (descendants.includes(parentId)) return current;
  }

  // Remove layerId from its current parent group
  let nextGroups: CaptureGroup[] = current
    .map((g) => ({
      ...g,
      childIds: g.childIds.filter((cid) => cid !== layerId),
    }))
    .filter((g) => g.childIds.length > 0);

  if (parentId !== null) {
    const parentLayer = layers.find((l) => l.id === parentId && l.role === 'zap')!;
    const existingGroupIndex = nextGroups.findIndex((g) => g.parentId === parentId);

    if (existingGroupIndex >= 0) {
      const existing = nextGroups[existingGroupIndex]!;
      const newChildIds = [...existing.childIds];
      const insertAt =
        index !== undefined && index >= 0 && index <= newChildIds.length
          ? index
          : newChildIds.length;
      newChildIds.splice(insertAt, 0, layerId);
      nextGroups[existingGroupIndex] = {
        ...existing,
        childIds: newChildIds,
      };
    } else {
      const baseId = `group-${parentLayer.stableId ?? parentLayer.id}`;
      let groupId = baseId;
      let suffix = 2;
      const usedIds = new Set(nextGroups.map((g) => g.id));
      while (usedIds.has(groupId)) {
        groupId = `${baseId}-${suffix++}`;
      }
      const newGroup: CaptureGroup = {
        id: groupId,
        parentId,
        childIds: [layerId],
      };
      nextGroups.push(newGroup);
    }
  }

  return sanitizeGroups(nextGroups, layers);
}

/**
 * Reorders a direct child inside its parent group.
 */
export function reorderChild(
  groups: CaptureGroup[] | undefined,
  parentId: string,
  childId: string,
  index: number,
): CaptureGroup[] {
  if (!groups) return [];
  const groupIndex = groups.findIndex((g) => g.parentId === parentId);
  if (groupIndex < 0) return [...groups];

  const group = groups[groupIndex]!;
  if (!group.childIds.includes(childId)) return [...groups];

  const filtered = group.childIds.filter((id) => id !== childId);
  const targetIdx = Math.max(0, Math.min(filtered.length, index));
  filtered.splice(targetIdx, 0, childId);

  const nextGroups = [...groups];
  nextGroups[groupIndex] = {
    ...group,
    childIds: filtered,
  };
  return nextGroups;
}

/**
 * Dissolves a group: children ascend to the grandparent group (in place of parent) or root.
 */
export function dissolveGroup(
  groups: CaptureGroup[] | undefined,
  parentId: string,
): CaptureGroup[] {
  if (!groups || groups.length === 0) return [];
  const targetGroup = groups.find((g) => g.parentId === parentId);
  if (!targetGroup) return [...groups];

  const children = [...targetGroup.childIds];
  const grandParentId = parentOfLayer(groups, parentId);

  if (grandParentId !== null) {
    return groups
      .filter((g) => g !== targetGroup)
      .map((g) => {
        if (g.parentId === grandParentId) {
          const idx = g.childIds.indexOf(parentId);
          const nextChildIds = [...g.childIds];
          if (idx >= 0) {
            nextChildIds.splice(idx + 1, 0, ...children);
          } else {
            nextChildIds.push(...children);
          }
          return { ...g, childIds: nextChildIds };
        }
        return g;
      });
  }

  return groups.filter((g) => g !== targetGroup);
}

/**
 * Builds a hierarchical tree of zap layers. Roots are zap layers without a parent, sorted by order.
 */
export function layerTree(
  groups: CaptureGroup[] | undefined,
  layers: CaptureLayer[],
): TreeNode[] {
  const zapLayers = layers.filter((l) => l.role === 'zap');
  const layerMap = new Map<string, CaptureLayer>(zapLayers.map((l) => [l.id, l]));
  const sanitized = sanitizeGroups(groups, layers);

  const roots = zapLayers.filter((l) => parentOfLayer(sanitized, l.id) === null);
  roots.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  const visited = new Set<string>();

  function buildNode(layer: CaptureLayer, depth: number): TreeNode {
    visited.add(layer.id);
    const childIds = childrenOfLayer(sanitized, layer.id);
    const children: TreeNode[] = [];
    for (const cid of childIds) {
      const childLayer = layerMap.get(cid);
      if (childLayer && !visited.has(cid)) {
        children.push(buildNode(childLayer, depth + 1));
      }
    }
    return { layer, depth, children };
  }

  return roots.map((root) => buildNode(root, 0));
}

/**
 * Flattens a layer tree in pre-order, respecting collapsed group IDs.
 */
export function flattenTree(
  tree: TreeNode[],
  collapsedIds: ReadonlySet<string>,
): FlattenedTreeNode[] {
  const result: FlattenedTreeNode[] = [];

  function walk(node: TreeNode) {
    const hasChildren = node.children.length > 0;
    const collapsed = hasChildren && collapsedIds.has(node.layer.id);
    result.push({
      layer: node.layer,
      depth: node.depth,
      hasChildren,
      collapsed,
    });
    if (!collapsed && hasChildren) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  for (const root of tree) {
    walk(root);
  }

  return result;
}

