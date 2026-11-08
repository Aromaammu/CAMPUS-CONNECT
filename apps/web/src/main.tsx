import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { UiProviders } from '@/components/ui';
import { AuthProvider } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { applyTheme, watchSystemTheme } from '@/lib/theme';
import { App } from '@/app/App';
import './index.css';

applyTheme();
watchSystemTheme();

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      retry: (count, e) => !(e instanceof ApiError && e.status < 500) && count < 2,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <UiProviders>
          <AuthProvider>
            <App />
          </AuthProvider>
        </UiProviders>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
