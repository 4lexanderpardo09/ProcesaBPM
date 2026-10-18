import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/global.css';
import { App } from '@/app/App';
import { createAppSession } from '@/app/session/create-app-session';
import { createQueryClient } from '@/shared/api';

const container = document.getElementById('root');
if (container === null) throw new Error('The #root element is missing from index.html');

const queryClient = createQueryClient();
const session = createAppSession(queryClient);
session.start();

createRoot(container).render(
  <StrictMode>
    <App queryClient={queryClient} session={session} />
  </StrictMode>,
);
