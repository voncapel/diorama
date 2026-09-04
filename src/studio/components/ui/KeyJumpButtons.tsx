import { ChevronLeft, ChevronRight } from 'lucide-react';
import { keyframeTimesForTarget, useStudio } from '../../store';

interface KeyJumpButtonsProps {
  compact?: boolean;
}

export function KeyJumpButtons({ compact = false }: KeyJumpButtonsProps) {
  const jumpToPrevKeyframe = useStudio((s) => s.jumpToPrevKeyframe);
  const jumpToNextKeyframe = useStudio((s) => s.jumpToNextKeyframe);
  const hasTarget = useStudio((s) => keyframeTimesForTarget(s).length > 0);
  const disabled = !hasTarget;

  return (
    <div className={`key-jump-buttons${compact ? ' compact' : ''}`}>
      <button
        type="button"
        className="icon-btn"
        title="Keyframe précédente (J)"
        aria-label="Keyframe précédente (J)"
        disabled={disabled}
        onClick={jumpToPrevKeyframe}
      >
        <ChevronLeft size={compact ? 12 : 14} />
      </button>
      <button
        type="button"
        className="icon-btn"
        title="Keyframe suivante (K)"
        aria-label="Keyframe suivante (K)"
        disabled={disabled}
        onClick={jumpToNextKeyframe}
      >
        <ChevronRight size={compact ? 12 : 14} />
      </button>
    </div>
  );
}
