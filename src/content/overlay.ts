import type { FrameFormatId } from '../shared/agentProtocol';
import { clusterSiblings, resolveTarget, staggerOrder } from './cluster';
import { tagLiveElements } from './serialize';

const Z = '2147483647';

const HOVER_COLOR = '#6366f1';
const PICKED_COLOR = '#22c55e';

export interface OverlayPickerState {
  open: boolean;
  selectors: string[];
  brief?: string;
  frameFormat?: FrameFormatId;
}

let currentPickerState: OverlayPickerState = {
  open: false,
  selectors: [],
};

export function pickerState(): OverlayPickerState {
  return { ...currentPickerState, selectors: [...currentPickerState.selectors] };
}

/** One accumulated pick: a whole cluster added by a single click. */
export interface ZapPick {
  members: Element[];
  score: number;
}

export interface ZapResult {
  /** Deduplicated concatenation of every pick, in global stagger order. */
  members: Element[];
  /** Mean cluster score across picks — kept for the legacy single-cluster caller. */
  score: number;
  picks: ZapPick[];
  intent: {
    brief?: string;
    frameFormat: FrameFormatId;
  };
}

interface Boxes {
  primary: HTMLDivElement;
  ghosts: HTMLDivElement[];
}

function makeBox(dashed: boolean, color = HOVER_COLOR): HTMLDivElement {
  const rgb = color === PICKED_COLOR ? '34,197,94' : '99,102,241';
  const box = document.createElement('div');
  box.style.cssText = [
    'position:absolute',
    'pointer-events:none',
    'box-sizing:border-box',
    `border:2px ${dashed ? 'dashed' : 'solid'} ${color}`,
    `background:rgba(${rgb},${dashed ? '0.08' : '0.16'})`,
    'border-radius:4px',
    'transition:none',
    dashed ? 'none' : `box-shadow:0 0 12px rgba(${rgb},0.4)`,
  ].join(';');
  return box;
}

function placeBox(box: HTMLDivElement, el: Element) {
  const r = el.getBoundingClientRect();
  box.style.left = `${r.x + window.scrollX}px`;
  box.style.top = `${r.y + window.scrollY}px`;
  box.style.width = `${r.width}px`;
  box.style.height = `${r.height}px`;
}

/**
 * Mounts the minimal inspection overlay on the page. Clicks accumulate clusters;
 * resolves with every pick on Enter, empty members for whole page, or null when
 * the user cancels with Escape. `initial` re-seeds a previous selection.
 */
export function mountOverlay(initial: Element[] = []): Promise<ZapResult | null> {
  tagLiveElements();

  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.setAttribute('data-diorama-overlay', '1');
    host.style.cssText = [
      'position:absolute',
      'inset:0',
      `z-index:${Z}`,
      'pointer-events:none',
      `width:${document.documentElement.scrollWidth}px`,
      `height:${document.documentElement.scrollHeight}px`,
      'top:0',
      'left:0',
    ].join(';');

    const layer = document.createElement('div');
    layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    host.appendChild(layer);

    const badge = document.createElement('div');
    badge.style.cssText = [
      'position:fixed',
      'pointer-events:none',
      'padding:4px 8px',
      'border-radius:6px',
      'background:#6366f1',
      'color:#fff',
      'font:600 11px/1.4 ui-sans-serif,system-ui,sans-serif',
      'box-shadow:0 4px 14px rgba(0,0,0,.4)',
      'display:none',
      'z-index:20',
      'white-space:nowrap',
    ].join(';');
    host.appendChild(badge);

    const hud = document.createElement('div');
    hud.style.cssText = [
      'position:fixed',
      'left:50%',
      'bottom:24px',
      'transform:translateX(-50%)',
      'pointer-events:auto',
      'display:flex',
      'flex-direction:column',
      'gap:10px',
      'padding:12px 14px',
      'border-radius:10px',
      'background:#121218',
      'color:#e6e6ee',
      'border:1px solid #2a2a35',
      'font:500 12px/1.4 ui-sans-serif,system-ui,sans-serif',
      'box-shadow:0 8px 32px rgba(0,0,0,.6)',
      'z-index:30',
      'min-width:440px',
      'max-width:540px',
    ].join(';');

    // Top section of HUD: Brief input, Frame format select, and hint note
    const briefContainer = document.createElement('div');
    briefContainer.style.cssText = 'display:flex;flex-direction:column;gap:6px;width:100%;';

    const inputsRow = document.createElement('div');
    inputsRow.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;';

    const briefInput = document.createElement('input');
    briefInput.type = 'text';
    briefInput.placeholder = 'Que voulez-vous mettre en avant ? (facultatif)';
    briefInput.style.cssText = [
      'flex:1',
      'padding:6px 10px',
      'border-radius:6px',
      'border:1px solid #2a2a35',
      'background:#1c1c24',
      'color:#e6e6ee',
      'font:500 12px/1.4 ui-sans-serif,system-ui,sans-serif',
      'outline:none',
      'box-sizing:border-box',
    ].join(';');

    const formatSelect = document.createElement('select');
    formatSelect.style.cssText = [
      'padding:6px 8px',
      'border-radius:6px',
      'border:1px solid #2a2a35',
      'background:#1c1c24',
      'color:#e6e6ee',
      'font:500 12px/1.4 ui-sans-serif,system-ui,sans-serif',
      'outline:none',
      'cursor:pointer',
      'box-sizing:border-box',
    ].join(';');

    const formatOptions: Array<{ id: FrameFormatId; label: string }> = [
      { id: 'landscape-16-9', label: 'Paysage 16:9' },
      { id: 'portrait-9-16', label: 'Portrait 9:16' },
      { id: 'square-1-1', label: 'Carré 1:1' },
      { id: 'portrait-4-5', label: 'Portrait 4:5' },
      { id: 'landscape-4-3', label: 'Paysage 4:3' },
      { id: 'cinema-21-9', label: 'Cinéma 21:9' },
    ];
    for (const opt of formatOptions) {
      const optionEl = document.createElement('option');
      optionEl.value = opt.id;
      optionEl.textContent = opt.label;
      if (opt.id === 'landscape-16-9') optionEl.selected = true;
      formatSelect.appendChild(optionEl);
    }

    inputsRow.appendChild(briefInput);
    inputsRow.appendChild(formatSelect);
    briefContainer.appendChild(inputsRow);

    const briefHint = document.createElement('div');
    briefHint.style.cssText = 'font-size:11px;color:#888899;line-height:1.2;';
    briefHint.textContent = 'Un agent IA pourra lire ce brief et animer la scène';
    briefContainer.appendChild(briefHint);

    hud.appendChild(briefContainer);

    // Prevent key events in the input from triggering overlay shortcuts
    briefInput.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Escape') {
        briefInput.blur();
      }
    });

    const bottomRow = document.createElement('div');
    bottomRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;';

    const hudLabel = document.createElement('span');
    hudLabel.innerHTML = 'Survolez un élément à détacher · <strong>Clic</strong> pour l\'ajouter';
    bottomRow.appendChild(hudLabel);

    const btnGroup = document.createElement('div');
    btnGroup.style.cssText = 'display:flex;align-items:center;gap:6px;margin-left:4px;';

    const captureBtn = document.createElement('button');
    captureBtn.style.cssText = [
      'pointer-events:auto',
      'padding:5px 12px',
      'border-radius:6px',
      'border:0',
      'background:#6366f1',
      'color:#fff',
      'font:600 12px/1.4 ui-sans-serif,system-ui,sans-serif',
      'cursor:pointer',
      'transition:background 0.15s ease',
    ].join(';');
    btnGroup.appendChild(captureBtn);

    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Tout désélectionner';
    clearBtn.style.cssText = [
      'pointer-events:auto',
      'padding:5px 10px',
      'border-radius:6px',
      'border:1px solid #3a3a48',
      'background:#1c1c24',
      'color:#c7c7d4',
      'font:500 12px/1.4 ui-sans-serif,system-ui,sans-serif',
      'cursor:pointer',
    ].join(';');
    btnGroup.appendChild(clearBtn);

    const wholePageBtn = document.createElement('button');
    wholePageBtn.textContent = 'Page entière';
    wholePageBtn.style.cssText = [
      'pointer-events:auto',
      'padding:5px 10px',
      'border-radius:6px',
      'border:1px solid #3a3a48',
      'background:#1c1c24',
      'color:#c7c7d4',
      'font:500 12px/1.4 ui-sans-serif,system-ui,sans-serif',
      'cursor:pointer',
    ].join(';');
    btnGroup.appendChild(wholePageBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '✕';
    cancelBtn.title = 'Annuler (Échap)';
    cancelBtn.style.cssText = [
      'pointer-events:auto',
      'padding:5px 8px',
      'border-radius:6px',
      'border:1px solid #3a3a48',
      'background:transparent',
      'color:#999',
      'font:500 12px/1.4 ui-sans-serif,system-ui,sans-serif',
      'cursor:pointer',
    ].join(';');
    btnGroup.appendChild(cancelBtn);

    bottomRow.appendChild(btnGroup);
    hud.appendChild(bottomRow);
    host.appendChild(hud);

    document.documentElement.appendChild(host);

    const boxes: Boxes = { primary: makeBox(false), ghosts: [] };
    layer.appendChild(boxes.primary);
    boxes.primary.style.display = 'none';

    // Persistent selection layer, never touched by clearGhosts().
    const pickedLayer = document.createElement('div');
    pickedLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    host.insertBefore(pickedLayer, layer);

    const picks: ZapPick[] = [];
    const pickedBoxes = new Map<Element, HTMLDivElement>();

    function pickIndexOf(el: Element): number {
      return picks.findIndex((pick) => pick.members.includes(el));
    }

    function selectedCount(): number {
      return pickedBoxes.size;
    }

    function getSelectors(): string[] {
      const out: string[] = [];
      for (const el of pickedBoxes.keys()) {
        const dioId = el.getAttribute('data-dio-id');
        if (dioId) out.push(`[data-dio-id="${dioId}"]`);
      }
      return out;
    }

    function updatePickerState() {
      const briefVal = briefInput.value.trim();
      const formatVal = (formatSelect.value as FrameFormatId) || 'landscape-16-9';
      currentPickerState = {
        open: true,
        selectors: getSelectors(),
        brief: briefVal || undefined,
        frameFormat: formatVal,
      };
    }

    briefInput.addEventListener('input', updatePickerState);
    formatSelect.addEventListener('change', updatePickerState);

    function syncHud() {
      const n = selectedCount();
      captureBtn.textContent = `Ouvrir le Studio (${n})`;
      captureBtn.disabled = n === 0;
      captureBtn.style.background = n === 0 ? '#2a2a35' : '#6366f1';
      captureBtn.style.color = n === 0 ? '#6b6b7b' : '#fff';
      captureBtn.style.cursor = n === 0 ? 'not-allowed' : 'pointer';
      clearBtn.disabled = n === 0;
      clearBtn.style.opacity = n === 0 ? '0.45' : '1';
      clearBtn.style.cursor = n === 0 ? 'not-allowed' : 'pointer';
      updatePickerState();
    }

    function addPickedBox(el: Element) {
      const box = makeBox(false, PICKED_COLOR);
      placeBox(box, el);
      pickedLayer.appendChild(box);
      pickedBoxes.set(el, box);
    }

    function removePickedBox(el: Element) {
      pickedBoxes.get(el)?.remove();
      pickedBoxes.delete(el);
    }

    function togglePick(hovered: Element) {
      const target = resolveTarget(hovered);
      const existing = pickIndexOf(target);
      if (existing >= 0) {
        for (const member of picks[existing]!.members) removePickedBox(member);
        picks.splice(existing, 1);
      } else {
        const result = clusterSiblings(target);
        const members = result.members.filter((m) => !pickedBoxes.has(m));
        if (members.length === 0) return;
        picks.push({ members, score: result.score });
        for (const member of members) addPickedBox(member);
      }
      syncHud();
    }

    function repositionPicked() {
      for (const [el, box] of pickedBoxes) placeBox(box, el);
    }

    function clearGhosts() {
      for (const g of boxes.ghosts) g.remove();
      boxes.ghosts = [];
    }

    function highlight(hovered: Element) {
      const target = resolveTarget(hovered);
      const result = clusterSiblings(target);
      const alreadyPicked = pickIndexOf(target) >= 0;

      boxes.primary.style.display = 'block';
      placeBox(boxes.primary, target);

      clearGhosts();
      for (const member of result.members) {
        if (member === target) continue;
        const ghost = makeBox(true);
        placeBox(ghost, member);
        layer.appendChild(ghost);
        boxes.ghosts.push(ghost);
      }

      const r = target.getBoundingClientRect();
      const action = alreadyPicked ? 'Clic pour retirer' : 'Clic pour ajouter';
      badge.style.display = 'block';
      if (result.members.length > 1) {
        badge.textContent = `⚡ ${result.members.length} éléments · ${action}`;
        hudLabel.innerHTML = `<strong>⚡ ${result.members.length} éléments similaires ciblés</strong> · ${action}`;
      } else {
        badge.textContent = `1 élément · ${action}`;
        hudLabel.innerHTML = `<strong>1 élément ciblé</strong> · ${action}`;
      }
      badge.style.left = `${Math.max(4, r.x)}px`;
      badge.style.top = `${Math.max(4, r.y - 24)}px`;
    }

    function onMove(ev: MouseEvent) {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      if (!el || el === document.body || el === document.documentElement) return;
      if (host.contains(el)) return;
      highlight(el);
    }

    /** Global stagger order over the deduplicated union of every pick. */
    function collect(): ZapResult {
      const members = staggerOrder([...pickedBoxes.keys()]);
      const score =
        picks.length > 0
          ? picks.reduce((sum, pick) => sum + pick.score, 0) / picks.length
          : 1;
      const briefVal = briefInput.value.trim();
      const formatVal = (formatSelect.value as FrameFormatId) || 'landscape-16-9';
      return {
        members,
        score,
        picks: picks.map((p) => ({ ...p })),
        intent: {
          brief: briefVal || undefined,
          frameFormat: formatVal,
        },
      };
    }

    function finish(result: ZapResult | null) {
      currentPickerState = {
        open: false,
        selectors: [],
      };
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('scroll', repositionPicked, true);
      window.removeEventListener('resize', repositionPicked);
      host.remove();
      resolve(result);
    }

    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        finish(null);
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        finish(collect());
      }
    }

    function onClick(ev: MouseEvent) {
      if (host.contains(ev.target as Node)) return;
      ev.preventDefault();
      ev.stopPropagation();
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      if (!el || el === document.body || el === document.documentElement) return;
      togglePick(el);
      highlight(el);
    }

    captureBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (selectedCount() === 0) return;
      finish(collect());
    });

    clearBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      for (const box of pickedBoxes.values()) box.remove();
      pickedBoxes.clear();
      picks.length = 0;
      syncHud();
    });

    wholePageBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const briefVal = briefInput.value.trim();
      const formatVal = (formatSelect.value as FrameFormatId) || 'landscape-16-9';
      finish({
        members: [],
        score: 1,
        picks: [],
        intent: {
          brief: briefVal || undefined,
          frameFormat: formatVal,
        },
      });
    });

    cancelBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      finish(null);
    });

    // Re-seed a previous selection: one pick per element, clustering already applied.
    for (const el of initial) {
      if (pickedBoxes.has(el)) continue;
      picks.push({ members: [el], score: 1 });
      addPickedBox(el);
    }
    syncHud();

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('click', onClick, true);
    window.addEventListener('scroll', repositionPicked, true);
    window.addEventListener('resize', repositionPicked);
  });
}

export function showToast(message: string): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-diorama-ui', 'toast');
  el.style.cssText = [
    'position:fixed',
    'left:50%',
    'top:24px',
    'transform:translateX(-50%)',
    `z-index:${Z}`,
    'padding:10px 18px',
    'border-radius:8px',
    'background:#121218',
    'color:#e6e6ee',
    'border:1px solid #6366f1',
    'font:600 13px/1.5 ui-sans-serif,system-ui,sans-serif',
    'box-shadow:0 8px 30px rgba(0,0,0,.6)',
    'pointer-events:none',
    'display:flex',
    'align-items:center',
    'gap:10px',
  ].join(';');
  el.innerHTML = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#6366f1;animation:diorama-pulse 1s infinite alternate;"></span><span>${message}</span>`;
  document.documentElement.appendChild(el);
  return el;
}

export function showError(message: string) {
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed',
    'left:50%',
    'top:24px',
    'transform:translateX(-50%)',
    `z-index:${Z}`,
    'padding:12px 16px',
    'border-radius:8px',
    'background:#2a1116',
    'color:#ffb4bd',
    'border:1px solid #6b2230',
    'font:500 13px/1.5 ui-sans-serif,system-ui,sans-serif',
    'max-width:520px',
  ].join(';');
  el.textContent = message;
  document.documentElement.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}
