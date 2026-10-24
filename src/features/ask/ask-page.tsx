import { AssistantRuntimeProvider, ComposerPrimitive, ThreadPrimitive, useExternalStoreRuntime, type ThreadMessage } from '@assistant-ui/react';
import { ArrowRight, LockKeyhole, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

const messages: readonly ThreadMessage[] = [];
async function unavailable(): Promise<void> {
  throw new Error('Chat is not available in this foundation preview.');
}

export function AskPage() {
  const runtime = useExternalStoreRuntime({ messages, isRunning: false, isDisabled: true, onNew: unavailable });

  return (
    <div className="ask-page">
      <header className="page-heading">
        <p className="eyebrow">A clearer picture, one question at a time</p>
        <h1 tabIndex={-1}>Ask Vulpes</h1>
        <p>Understand your measurements. Find a way forward.</p>
      </header>
      <AssistantRuntimeProvider runtime={runtime}>
        <ThreadPrimitive.Root className="conversation" aria-label="Conversation">
          <ThreadPrimitive.Viewport className="conversation-viewport">
            <ThreadPrimitive.Empty>
              <Card className="welcome-card">
                <div className="feature-symbol"><Sparkles size={24} aria-hidden="true" /></div>
                <p className="eyebrow">Start with what you know</p>
                <h2>Your data comes first.</h2>
                <p>Vulpes will help you explore your own measurements and work toward goals you choose. No measurements are loaded in this preview.</p>
                <Button asChild><Link to="/data">Explore Data <ArrowRight size={16} aria-hidden="true" /></Link></Button>
              </Card>
              <section className="sample-questions" aria-labelledby="sample-heading">
                <h2 id="sample-heading">Questions to explore when chat is available</h2>
                <ul>
                  <li>How has my weight changed over time?</li>
                  <li>Do I have enough data to see a trend?</li>
                </ul>
              </section>
            </ThreadPrimitive.Empty>
          </ThreadPrimitive.Viewport>
          <div className="composer-area">
            <p id="chat-unavailable" className="availability-note"><LockKeyhole size={14} aria-hidden="true" /> Chat is not available in this foundation preview.</p>
            <ComposerPrimitive.Root className="composer">
              <ComposerPrimitive.Input aria-label="Message Ask Vulpes" aria-describedby="chat-unavailable" placeholder="Ask about your measurements…" disabled rows={1} />
              <span className="composer-label">Unavailable</span>
            </ComposerPrimitive.Root>
            <p className="wellness-note">Personal wellness information. Not medical diagnosis or emergency monitoring.</p>
          </div>
        </ThreadPrimitive.Root>
      </AssistantRuntimeProvider>
    </div>
  );
}
