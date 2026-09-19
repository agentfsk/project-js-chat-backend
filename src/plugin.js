// @ts-check

import fastifySocketIo from '@wick_studio/fastify-socket.io';
import fastifyJWT from '@fastify/jwt';
import HttpErrors from 'http-errors';
import fastifyCors from '@fastify/cors';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';

import addRoutes from './routes.js';
import { ensureUploadDir, uploadDir, uploadSizeLimit } from './uploads.js';

const { Unauthorized } = HttpErrors;

const setUpAuth = (app) => {
  app
    .register(fastifyJWT, {
      secret: 'supersecret',
    })
    .decorate('authenticate', async (req, reply) => {
      try {
        await req.jwtVerify();
      } catch (_err) {
        reply.send(new Unauthorized());
      }
    });
};

const setUpSocketAuth = (app) => {
  app.io.use((socket, next) => {
    const token = socket?.handshake?.auth?.token;
    if (!token) {
      next(new Error('unauthorized'));
      return;
    }
    try {
      const payload = app.jwt.verify(token);
      // eslint-disable-next-line no-param-reassign
      socket.userId = payload.userId;
      socket.join(`user:${payload.userId}`);
      next();
    } catch (_err) {
      next(new Error('unauthorized'));
    }
  });
};

export default async (app, options) => {
  setUpAuth(app);
  await app.register(fastifyCors, {
    origin: '*',
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
  });
  await app.register(fastifySocketIo, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });
  setUpSocketAuth(app);
  ensureUploadDir();
  await app.register(fastifyStatic, {
    root: uploadDir,
    prefix: '/uploads/',
  });
  await app.register(fastifyMultipart, {
    limits: {
      files: 1,
      fileSize: uploadSizeLimit,
    },
  });
  addRoutes(app, options?.state || {});

  return app;
};
