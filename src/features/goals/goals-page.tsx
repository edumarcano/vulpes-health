import { Target } from 'lucide-react';
import { Card } from '@/components/ui/card';

export function GoalsPage() {
  return (
    <>
      <header className="page-heading"><p className="eyebrow">Progress on your terms</p><h1 tabIndex={-1}>Goals</h1><p>Work toward the changes that matter to you.</p></header>
      <Card className="empty-card"><div className="feature-symbol"><Target aria-hidden="true" /></div><h2>No goals available</h2><p>Goal creation and progress tracking are not available in this foundation preview.</p><p className="detail-note">Future goal changes will need your explicit review and approval. This preview cannot create or activate a goal.</p></Card>
    </>
  );
}
