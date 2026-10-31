import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import App from './App.tsx';
import AppErrorBoundary from './components/AppErrorBoundary';
import { initializeSentry } from './lib/sentry';

void initializeSentry();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 2, // 2 minuta
      retry: 1,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppErrorBoundary onReset={() => { void queryClient.resetQueries({ predicate: (query) => query.state.status === 'error' }); }}>
        <App />
      </AppErrorBoundary>
    </QueryClientProvider>
  </StrictMode>
);
