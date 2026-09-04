import { useStudio } from '../../store';
import type { ChannelId } from '../../model/channels';

/** Two times are "the same keyframe" within a millisecond. */
const KEY_TOLERANCE = 1e-3;

interface KeyDotProps {
  /** null for camera and scene channels; an array edits every layer at once. */
  layerId: string | null | readonly string[];
  channel: ChannelId;
}

/**
 * Diamond next to a property. Empty = no keyframe on the track, outlined =
 * animated track, filled = keyframe under the playhead. Click toggles a key at
 * the playhead. With several layers the dot reflects the first one that is
 * animated, and the click applies to all of them.
 */
export function KeyDot({ layerId, channel }: KeyDotProps) {
  const ids: (string | null)[] = Array.isArray(layerId) ? [...layerId] : [layerId as string | null];
  const state = useStudio((s) => {
    let animated = false;
    let keyed = false;
    for (const id of ids) {
      for (const k of s.keyframes) {
        if (k.channel !== channel || k.layerId !== id) continue;
        animated = true;
        if (Math.abs(k.time - s.playhead) < KEY_TOLERANCE) keyed = true;
      }
    }
    return animated ? (keyed ? 'keyed' : 'animated') : 'empty';
  });
  const toggleKeyAtPlayhead = useStudio((s) => s.toggleKeyAtPlayhead);

  const title =
    state === 'keyed'
      ? 'Retirer la keyframe à la tête de lecture'
      : state === 'animated'
        ? 'Ajouter une keyframe à la tête de lecture (piste animée)'
        : 'Ajouter une keyframe à la tête de lecture';

  return (
    <button
      type="button"
      className={`keydot ${state}`}
      title={title}
      aria-label={title}
      aria-pressed={state === 'keyed'}
      onClick={() => {
        for (const id of ids) toggleKeyAtPlayhead(id, channel);
      }}
    />
  );
}
