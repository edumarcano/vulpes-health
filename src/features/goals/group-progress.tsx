import { Link } from 'react-router-dom';
import type { GoalGroupProgress } from '../../../shared/goal-groups';
import { Progress } from './goal-progress';

const outcomes = {
  met: 'Meeting condition',
  not_met: 'Not meeting condition',
  needs_data: 'Needs data',
  needs_review: 'Needs review',
  stale: 'Stale evidence',
  archived: 'Archived member',
  unavailable: 'Unavailable',
};

export function GroupProgress({ value }: { value: GoalGroupProgress }) {
  return (
    <section aria-label="Group progress">
      <h3>All-members condition</h3>
      <p>
        {value.conditionStatus === 'meeting_conditions'
          ? 'Every required member is currently meeting its condition.'
          : value.conditionStatus === 'not_meeting_conditions'
            ? 'At least one required member is not meeting its condition.'
            : 'The all-members condition is unavailable. Review each member below.'}
      </p>
      <p>
        Administrative state: {value.administrativeState} · Evaluated{' '}
        {value.evaluatedAt} · Data revision {value.dataRevision}
      </p>
      <p>Each member keeps its own units, evidence dates and calculation.</p>
      <ol className="space-y-4">
        {value.members.map((member) => (
          <li key={member.position} className="min-w-0 break-words">
            <h4>
              {member.position}. {member.title}
            </h4>
            <p>
              {outcomes[member.outcome]} · Goal state:{' '}
              {member.state ?? 'unavailable'} · Reviewed version{' '}
              {member.reviewedVersion} · Current version{' '}
              {member.currentVersion ?? 'unavailable'}
            </p>
            {member.progress && <Progress value={member.progress} />}
            <Link to={'/goals?goal=' + member.goalId}>
              Open {member.title} detail and history
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
