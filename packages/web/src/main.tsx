import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { LocaleProvider } from './lib/i18n';
import { initialLocale, setActiveLocale } from './lib/i18n/locale';
import { registerServiceWorker } from './lib/registerServiceWorker';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Albums change only when syncs run: refetching on every tab return would
      // merely reload identical data.
      refetchOnWindowFocus: false,
      staleTime: 60 * 1000,
      retry: 1,
    },
  },
});

registerServiceWorker();

// Before the first render, and therefore before the first request: `api/client.ts`
// announces this language with `Accept-Language`, which is how the server knows
// which language to write its errors and emails in.
setActiveLocale(initialLocale());

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </LocaleProvider>
    </QueryClientProvider>
  </StrictMode>,
);
