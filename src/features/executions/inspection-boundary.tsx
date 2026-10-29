import { Component, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

export class InspectionBoundary extends Component<{children:ReactNode;onClose:()=>void},{kind:'ready'|'failed'}> {
  state:{kind:'ready'|'failed'}={kind:'ready'};
  static getDerivedStateFromError():{kind:'failed'} { return {kind:'failed'}; }
  render() {
    return this.state.kind==='failed' ? <section role="alert" aria-label="Inspector unavailable">
      <p>The inspector could not be loaded. Your saved conversation remains available.</p>
      <Button variant="outline" onClick={this.props.onClose}>Dismiss inspector error</Button>
      <Button variant="outline" onClick={()=>window.location.reload()}>Reload application</Button>
    </section> : this.props.children;
  }
}
