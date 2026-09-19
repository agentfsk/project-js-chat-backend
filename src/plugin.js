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
  // TODO add socket auth
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

export default async (app, options) => {
  setUpAuth(app);
  await app.register(fastifyCors, {
    origin: '*',
  });
  await app.register(fastifySocketIo, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });
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
