import './zod-config';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/global.css';
import { App } from '@/app/App';
import { createAppSession } from '@/app/session/create-app-session';
import { createQueryClient } from '@/shared/api';
import { createRealtimeClient, openSocketIo } from '@/shared/realtime';

const container = document.getElementById('root');
if (container === null) throw new Error('The #root element is missing from index.html');

const queryClient = createQueryClient();
const session = createAppSession(queryClient);
session.start();
const realtime = createRealtimeClient({ tokens: session.accessTokens, openSocket: openSocketIo });

createRoot(container).render(
  <StrictMode>
    <App queryClient={queryClient} session={session} realtime={realtime} />
  </StrictMode>,
);
