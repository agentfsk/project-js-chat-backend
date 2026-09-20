// @ts-check

import _ from 'lodash';
import HttpErrors from 'http-errors';

import { storeAvatar, storeUpload } from './uploads.js';

const { Unauthorized, BadRequest } = HttpErrors;

const getNextId = () => Number(_.uniqueId());

const FRONTEND_URL = process.env.FRONTEND_URL || '#';
const BACKEND_REPO_URL = process.env.BACKEND_REPO_URL || '#';
const FRONTEND_REPO_URL = process.env.FRONTEND_REPO_URL || '#';

const publicProfile = (user) => ({
  id: user.id,
  username: user.username,
  avatarUrl: user.avatarUrl || null,
  role: user.role || 'user',
});

const isAdminUser = (state, userId) => {
  const user = state.users.find((candidate) => candidate.id === userId);
  return Boolean(user && user.role === 'admin');
};

const isPrivateChannel = (channel) => (
  Boolean(channel.private) && Array.isArray(channel.participants)
);

const hasAccess = (channel, userId) => (
  !isPrivateChannel(channel) || channel.participants.includes(userId)
);

const emitToChannel = (app, channel, eventName, payload) => {
  if (isPrivateChannel(channel)) {
    channel.participants.forEach((userId) => {
      app.io.to(`user:${userId}`).emit(eventName, payload);
    });
    return;
  }
  app.io.emit(eventName, payload);
};

const findPrivateChannel = (state, firstId, secondId) => (
  state.channels.find((channel) => (
    isPrivateChannel(channel)
    && channel.participants.includes(firstId)
    && channel.participants.includes(secondId)
  ))
);

const getOrCreatePrivateChannel = (state, firstId, secondId) => {
  const existing = findPrivateChannel(state, firstId, secondId);
  if (existing) return existing;

  const peer = state.users.find((user) => user.id === secondId);
  const channel = {
    id: getNextId(),
    name: peer ? peer.username : 'ЛС',
    removable: false,
    private: true,
    participants: [firstId, secondId],
  };
  state.channels.push(channel);
  return channel;
};

const getCurrentUser = (req, state) => state.users.find((user) => user.id === req.user.userId);

const findMessageAndChannel = (state, messageId) => {
  const id = Number(messageId);
  const message = state.messages.find((candidate) => candidate.id === id);
  if (!message) return null;
  const channel = state.channels.find((candidate) => candidate.id === message.channelId);
  if (!channel) return null;
  return { message, channel };
};

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
    contactRequests: [],
    users: [
      {
        id: 1,
        username: 'admin',
        email: 'admin@example.com',
        password: 'admin',
        avatarUrl: null,
        contacts: [],
        role: 'admin',
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
    console.log({ 'socket.id': socket.id, userId: socket.userId });

    socket.on('newMessage', (message, acknowledge = _.noop) => {
      const channel = state.channels.find((c) => c.id === Number(message.channelId));
      if (!channel) {
        acknowledge({ status: 'error', message: 'Канал не найден' });
        return;
      }
      if (!hasAccess(channel, socket.userId)) {
        acknowledge({ status: 'error', message: 'Доступ запрещён' });
        return;
      }

      const sender = state.users.find((candidate) => candidate.id === socket.userId);
      const messageWithId = {
        ...message,
        id: getNextId(),
        userId: socket.userId,
        username: message.username || (sender ? sender.username : ''),
        createdAt: new Date().toISOString(),
        edited: false,
        pinned: false,
      };
      // @ts-ignore
      state.messages.push(messageWithId);
      acknowledge({ status: 'ok' });

      if (isPrivateChannel(channel)) {
        emitToChannel(app, channel, 'newMessage', {
          ...messageWithId,
          channel,
        });
        return;
      }
      app.io.emit('newMessage', messageWithId);
    });

    socket.on('editMessage', ({ messageId, body }, acknowledge = _.noop) => {
      const found = findMessageAndChannel(state, messageId);
      if (!found) {
        acknowledge({ status: 'error', message: 'Сообщение не найдено' });
        return;
      }
      const { message, channel } = found;
      if (!hasAccess(channel, socket.userId)) {
        acknowledge({ status: 'error', message: 'Доступ запрещён' });
        return;
      }
      const isAuthor = message.userId === socket.userId;
      if (!isAuthor && !isAdminUser(state, socket.userId)) {
        acknowledge({ status: 'error', message: 'Нельзя редактировать сообщение' });
        return;
      }

      message.body = String(body ?? '');
      message.edited = true;
      acknowledge({ status: 'ok' });
      emitToChannel(app, channel, 'messageEdited', message);
    });

    socket.on('deleteMessage', ({ messageId }, acknowledge = _.noop) => {
      const found = findMessageAndChannel(state, messageId);
      if (!found) {
        acknowledge({ status: 'error', message: 'Сообщение не найдено' });
        return;
      }
      const { message, channel } = found;
      if (!hasAccess(channel, socket.userId)) {
        acknowledge({ status: 'error', message: 'Доступ запрещён' });
        return;
      }
      const isAuthor = message.userId === socket.userId;
      if (!isAuthor && !isAdminUser(state, socket.userId)) {
        acknowledge({ status: 'error', message: 'Нельзя удалить сообщение' });
        return;
      }

      state.messages = state.messages.filter((candidate) => candidate.id !== message.id);
      acknowledge({ status: 'ok' });
      emitToChannel(app, channel, 'messageDeleted', {
        messageId: message.id,
        channelId: channel.id,
      });
    });

    socket.on('pinMessage', ({ messageId, pinned }, acknowledge = _.noop) => {
      const found = findMessageAndChannel(state, messageId);
      if (!found) {
        acknowledge({ status: 'error', message: 'Сообщение не найдено' });
        return;
      }
      const { message, channel } = found;
      if (!hasAccess(channel, socket.userId)) {
        acknowledge({ status: 'error', message: 'Доступ запрещён' });
        return;
      }
      const pinAllowed = isPrivateChannel(channel) || isAdminUser(state, socket.userId);
      if (!pinAllowed) {
        acknowledge({ status: 'error', message: 'Нельзя закрепить сообщение' });
        return;
      }

      message.pinned = Boolean(pinned);
      acknowledge({ status: 'ok' });
      emitToChannel(app, channel, 'messagePinned', {
        messageId: message.id,
        channelId: channel.id,
        pinned: message.pinned,
      });
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
      const channel = state.channels.find((c) => c.id === channelId);
      if (!channel || isPrivateChannel(channel)) {
        acknowledge({ status: 'error', message: 'Канал не может быть удалён' });
        return;
      }

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
      if (!channel || isPrivateChannel(channel)) {
        acknowledge({ status: 'error', message: 'Канал не может быть переименован' });
        return;
      }
      channel.name = name;

      acknowledge({ status: 'ok' });
      emitToChannel(app, channel, 'renameChannel', channel);
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
      id: getNextId(), username, email, password, avatarUrl: null, contacts: [], role: 'user',
    };
    const token = app.jwt.sign({ userId: newUser.id });
    state.users.push(newUser);
    reply
      .code(201)
      .header('Content-Type', 'application/json; charset=utf-8')
      .send({ token, username });
  });

  app.get('/api/v1/data', { preValidation: [app.authenticate] }, (req, reply) => {
    const user = getCurrentUser(req, state);
    if (!user) {
      reply.send(new Unauthorized());
      return;
    }

    const channels = state.channels.filter((channel) => hasAccess(channel, user.id));
    const channelIds = new Set(channels.map((channel) => channel.id));
    // @ts-ignore
    const messages = state.messages.filter((message) => channelIds.has(message.channelId));
    const contacts = state.users
      .filter((candidate) => user.contacts.includes(candidate.id))
      .map(publicProfile);
    const requests = state.contactRequests
      .filter((request) => (
        request.toUserId === user.id && request.status === 'pending'
      ))
      .map((request) => {
        const fromUser = state.users.find((candidate) => candidate.id === request.fromUserId);
        return {
          id: request.id,
          from: publicProfile(fromUser),
          channelId: request.channelId,
        };
      });

    let { currentChannelId } = state;
    if (!channelIds.has(currentChannelId) && channels.length > 0) {
      currentChannelId = channels[0].id;
    }

    reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .send({
        channels,
        messages,
        currentChannelId,
        me: publicProfile(user),
        contacts,
        requests,
      });
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

  app.get('/api/v1/users/search', { preValidation: [app.authenticate] }, (req, reply) => {
    const user = getCurrentUser(req, state);
    if (!user) {
      reply.send(new Unauthorized());
      return;
    }

    const query = _.trim(String(req.query.query || '')).toLowerCase();
    const results = state.users
      .filter((candidate) => (
        candidate.id !== user.id
        && query
        && candidate.username.toLowerCase().includes(query)
      ))
      .map(publicProfile);

    reply.send(results);
  });

  app.patch('/api/v1/users/me', { preValidation: [app.authenticate] }, (req, reply) => {
    const user = getCurrentUser(req, state);
    if (!user) {
      reply.send(new Unauthorized());
      return;
    }

    const { username, avatarUrl } = req.body || {};
    let changed = false;

    if (
      username !== undefined
      && String(username).trim()
      && String(username).trim() !== user.username
    ) {
      const newUsername = String(username).trim();

      if (state.users.some((candidate) => (
        candidate.id !== user.id && candidate.username === newUsername
      ))) {
        reply.code(409).send({ error: 'Этот ник уже используется' });
        return;
      }

      const oldUsername = user.username;
      user.username = newUsername;
      // @ts-ignore
      for (let index = 0; index < state.messages.length; index += 1) {
        if (state.messages[index].username === oldUsername) {
          state.messages[index].username = newUsername;
        }
      }
      state.channels.forEach((channel) => {
        if (
          isPrivateChannel(channel)
          && channel.participants.includes(user.id)
          && channel.name === oldUsername
        ) {
          const channelIndex = state.channels.indexOf(channel);
          state.channels.splice(channelIndex, 1, {
            ...channel,
            name: newUsername,
          });
        }
      });
      changed = true;
    }

    if (avatarUrl !== undefined) {
      user.avatarUrl = avatarUrl ? String(avatarUrl) : null;
      changed = true;
    }

    reply.send(publicProfile(user));

    if (changed) {
      app.io.emit('userUpdated', {
        id: user.id,
        username: user.username,
        avatarUrl: user.avatarUrl,
      });
    }
  });

  app.post('/api/v1/avatars', { preValidation: [app.authenticate] }, async (req, reply) => {
    const file = await req.file();

    if (!file) {
      reply.send(new BadRequest('Файл не получен'));
      return;
    }

    try {
      const avatar = await storeAvatar(file);
      reply.send(avatar);
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

  app.post('/api/v1/private-channels', { preValidation: [app.authenticate] }, (req, reply) => {
    const user = getCurrentUser(req, state);
    if (!user) {
      reply.send(new Unauthorized());
      return;
    }

    const targetId = Number(_.get(req.body, 'userId'));
    const target = state.users.find((candidate) => candidate.id === targetId);
    if (!target) {
      reply.code(404).send({ error: 'Пользователь не найден' });
      return;
    }

    const channel = getOrCreatePrivateChannel(state, user.id, target.id);
    reply.send({ channel });
  });

  app.post('/api/v1/contacts', { preValidation: [app.authenticate] }, (req, reply) => {
    const user = getCurrentUser(req, state);
    if (!user) {
      reply.send(new Unauthorized());
      return;
    }

    const targetId = Number(_.get(req.body, 'userId'));
    const target = state.users.find((candidate) => candidate.id === targetId);
    if (!target) {
      reply.code(404).send({ error: 'Пользователь не найден' });
      return;
    }

    const channel = getOrCreatePrivateChannel(state, user.id, target.id);

    if (user.contacts.includes(targetId)) {
      reply.send({ requestId: null, channel, status: 'accepted' });
      return;
    }

    const existing = state.contactRequests.find((request) => (
      request.status === 'pending'
      && request.fromUserId === user.id
      && request.toUserId === targetId
    ));
    if (existing) {
      reply.send({ requestId: existing.id, channel, status: 'pending' });
      return;
    }

    const request = {
      id: getNextId(),
      fromUserId: user.id,
      toUserId: targetId,
      channelId: channel.id,
      status: 'pending',
    };
    state.contactRequests.push(request);

    app.io.to(`user:${targetId}`).emit('contactRequest', {
      requestId: request.id,
      from: publicProfile(user),
      channel,
    });

    reply.send({ requestId: request.id, channel, status: 'pending' });
  });

  app.post('/api/v1/contacts/:requestId/accept', { preValidation: [app.authenticate] }, (req, reply) => {
    const user = getCurrentUser(req, state);
    if (!user) {
      reply.send(new Unauthorized());
      return;
    }

    const requestId = Number(req.params.requestId);
    const request = state.contactRequests.find((candidate) => (
      candidate.id === requestId && candidate.toUserId === user.id
    ));
    if (!request) {
      reply.code(404).send({ error: 'Запрос не найден' });
      return;
    }

    const fromUser = state.users.find((candidate) => candidate.id === request.fromUserId);
    state.contactRequests = state.contactRequests.filter((candidate) => candidate.id !== requestId);

    if (fromUser) {
      if (!fromUser.contacts.includes(user.id)) fromUser.contacts.push(user.id);
      if (!user.contacts.includes(fromUser.id)) user.contacts.push(fromUser.id);
      app.io.to(`user:${fromUser.id}`).emit('contactAdded', { profile: publicProfile(user) });
      app.io.to(`user:${user.id}`).emit('contactAdded', { profile: publicProfile(fromUser) });
    }
    app.io.to(`user:${fromUser.id}`).emit('contactRequestResolved', { requestId, accepted: true });

    reply.send({ ok: true });
  });

  app.post('/api/v1/contacts/:requestId/decline', { preValidation: [app.authenticate] }, (req, reply) => {
    const user = getCurrentUser(req, state);
    if (!user) {
      reply.send(new Unauthorized());
      return;
    }

    const requestId = Number(req.params.requestId);
    const request = state.contactRequests.find((candidate) => (
      candidate.id === requestId && candidate.toUserId === user.id
    ));
    if (!request) {
      reply.code(404).send({ error: 'Запрос не найден' });
      return;
    }

    state.contactRequests = state.contactRequests.filter((candidate) => candidate.id !== requestId);
    app.io.to(`user:${request.fromUserId}`).emit('contactRequestResolved', { requestId, accepted: false });

    reply.send({ ok: true });
  });

  app.delete('/api/v1/contacts/:userId', { preValidation: [app.authenticate] }, (req, reply) => {
    const user = getCurrentUser(req, state);
    if (!user) {
      reply.send(new Unauthorized());
      return;
    }

    const targetId = Number(req.params.userId);
    if (!user.contacts.includes(targetId)) {
      reply.code(404).send({ error: 'Контакт не найден' });
      return;
    }

    user.contacts = user.contacts.filter((id) => id !== targetId);
    const target = state.users.find((candidate) => candidate.id === targetId);
    if (target) {
      target.contacts = target.contacts.filter((id) => id !== user.id);
    }
    app.io.to(`user:${user.id}`).emit('contactRemoved', { userId: targetId });
    app.io.to(`user:${targetId}`).emit('contactRemoved', { userId: user.id });

    reply.send({ ok: true });
  });
};
