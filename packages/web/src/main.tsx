import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Les albums ne changent qu'au rythme des synchronisations : refetcher à
      // chaque retour d'onglet ne ferait que recharger des données identiques.
      refetchOnWindowFocus: false,
      staleTime: 60 * 1000,
      retry: 1,
    },
  },
});

const container = document.getElementById('root');
if (!container) throw new Error('#root introuvable');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
