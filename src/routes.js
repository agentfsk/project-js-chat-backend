// @ts-check

import _ from 'lodash';
import HttpErrors from 'http-errors';

import { storeUpload } from './uploads.js';

const { Unauthorized, BadRequest } = HttpErrors;

const getNextId = () => Number(_.uniqueId());

const FRONTEND_URL = process.env.FRONTEND_URL || '#';
const BACKEND_REPO_URL = process.env.BACKEND_REPO_URL || '#';
const FRONTEND_REPO_URL = process.env.FRONTEND_REPO_URL || '#';

const renderLanding = (port) => `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Chat Backend</title>
  <style>
    body { font-family: system-ui, sans-serif; background:#0f1115; color:#e6e6e6; display:flex; min-height:100vh; align-items:center; justify-content:center; margin:0; }
    .card { max-width: 420px; padding: 2rem; }
    h1 { font-size: 1.4rem; margin-bottom: .5rem; }
    p { color:#a0a0a0; line-height:1.5; }
    a { color:#7dd3fc; text-decoration:none; }
    a:hover { text-decoration:underline; }
    ul { padding-left: 1.1rem; margin: 1.2rem 0 0; }
    li { margin-bottom: .4rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Chat Backend</h1>
    <p>API-сервер учебного мессенджера. Интерфейс развёрнут отдельно.</p>
    <p class="meta">Сервер и Socket.IO работают на порту <code>${port}</code></p>
    <ul>
      <li><a href="${FRONTEND_URL}" target="_blank">Открыть приложение</a></li>
      <li><a href="${BACKEND_REPO_URL}" target="_blank">Код бэкенда</a></li>
      <li><a href="${FRONTEND_REPO_URL}" target="_blank">Код фронтенда</a></li>
    </ul>
  </div>
</body>
</html>`;

const buildState = (defaultState) => {
  const generalChannelId = getNextId();
  const randomChannelId = getNextId();
  const state = {
    channels: [
      { id: generalChannelId, name: 'general', removable: false },
      { id: randomChannelId, name: 'random', removable: false },
    ],
    messages: [],
    currentChannelId: generalChannelId,
    users: [
      {
        id: 1, username: 'admin', email: 'admin@example.com', password: 'admin',
      },
    ],
  };

  if (defaultState.messages) {
    // @ts-ignore
    state.messages.push(...defaultState.messages);
  }
  if (defaultState.channels) {
    state.channels.push(...defaultState.channels);
  }
  if (defaultState.currentChannelId) {
    state.currentChannelId = defaultState.currentChannelId;
  }
  if (defaultState.users) {
    // Default users must carry an `email`, like the seeded admin.
    state.users.push(...defaultState.users);
  }

  return state;
};

export default (app, defaultState = {}) => {
  const state = buildState(defaultState);

  app.io.on('connect', (socket) => {
    console.log({ 'socket.id': socket.id });

    socket.on('newMessage', (message, acknowledge = _.noop) => {
      const messageWithId = {
        ...message,
        id: getNextId(),
      };
      // @ts-ignore
      state.messages.push(messageWithId);
      acknowledge({ status: 'ok' });
      app.io.emit('newMessage', messageWithId);
    });

    socket.on('newChannel', (channel, acknowledge = _.noop) => {
      const channelWithId = {
        ...channel,
        removable: true,
        id: getNextId(),
      };

      state.channels.push(channelWithId);
      acknowledge({ status: 'ok', data: channelWithId });
      app.io.emit('newChannel', channelWithId);
    });

    socket.on('removeChannel', ({ id }, acknowledge = _.noop) => {
      const channelId = Number(id);
      state.channels = state.channels.filter((c) => c.id !== channelId);
      // @ts-ignore
      state.messages = state.messages.filter((m) => m.channelId !== channelId);
      const data = { id: channelId };

      acknowledge({ status: 'ok' });
      app.io.emit('removeChannel', data);
    });

    socket.on('renameChannel', ({ id, name }, acknowledge = _.noop) => {
      const channelId = Number(id);
      const channel = state.channels.find((c) => c.id === channelId);
      if (!channel) return;
      channel.name = name;

      acknowledge({ status: 'ok' });
      app.io.emit('renameChannel', channel);
    });
  });

  app.post('/api/v1/login', async (req, reply) => {
    const identifier = _.get(req.body, 'identifier');
    const password = _.get(req.body, 'password');
    const normalizedEmail = _.trim(String(identifier || '')).toLowerCase();
    const user = state.users.find((u) => (
      u.email === normalizedEmail || u.username === identifier
    ));

    if (!user || user.password !== password) {
      reply.send(new Unauthorized());
      return;
    }

    const token = app.jwt.sign({ userId: user.id });
    reply.send({ token, username: user.username });
  });

  app.post('/api/v1/signup', async (req, reply) => {
    const email = _.get(req.body, 'email', '').trim().toLowerCase();
    const username = _.get(req.body, 'username');
    const password = _.get(req.body, 'password');

    if (state.users.some((u) => u.email === email)) {
      reply.code(409).send({ error: 'Этот email уже используется' });
      return;
    }

    if (state.users.some((u) => u.username === username)) {
      reply.code(409).send({ error: 'Этот ник уже используется' });
      return;
    }

    const newUser = {
      id: getNextId(), username, email, password,
    };
    const token = app.jwt.sign({ userId: newUser.id });
    state.users.push(newUser);
    reply
      .code(201)
      .header('Content-Type', 'application/json; charset=utf-8')
      .send({ token, username });
  });

  app.get('/api/v1/data', { preValidation: [app.authenticate] }, (req, reply) => {
    const user = state.users.find(({ id }) => id === req.user.userId);

    if (!user) {
      reply.send(new Unauthorized());
      return;
    }

    reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .send(_.omit(state, 'users'));
  });

  app
    .get('/', (_req, reply) => {
      const { port } = app.server.address();
      reply.type('text/html; charset=utf-8').send(renderLanding(port));
    });

  app.post('/api/v1/uploads', async (req, reply) => {
    const file = await req.file();

    if (!file) {
      reply.send(new BadRequest('Файл не получен'));
      return;
    }

    try {
      const attachment = await storeUpload(file);
      reply.send(attachment);
    } catch (err) {
      if (err instanceof BadRequest) {
        reply.send(err);
        return;
      }
      if (err.name === 'RequestFileTooLargeError') {
        reply.code(err.statusCode || 413).send({ error: 'Файл слишком большой' });
        return;
      }
      throw err;
    }
  });
};
