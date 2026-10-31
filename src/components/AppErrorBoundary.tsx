import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportReactError } from '../lib/sentry';

export default class AppErrorBoundary extends Component<
  { children: ReactNode; onReset: () => void }, { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportReactError(error, info);
    console.error('Greška pri prikazu aplikacije:', error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main role="alert" style={{ padding: '2rem', textAlign: 'center' }}>
        <h1>Nije moguće prikazati stranicu.</h1>
        <p>Pokušajte ponovo. Ako se problem nastavi, ponovo učitajte aplikaciju.</p>
        <button type="button" onClick={() => {
          this.props.onReset();
          this.setState({ failed: false });
        }}>Pokušaj ponovo</button>{' '}
        <button type="button" onClick={() => window.location.reload()}>Ponovo učitaj aplikaciju</button>
      </main>
    );
  }
}
