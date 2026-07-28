process.env.NODE_ENV = 'test';

import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from '@jest/globals';

describe('Authentication API', () => {
  let app: any;
  let mongoServer: MongoMemoryServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri(), {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    } as mongoose.ConnectOptions);
  });

  beforeEach(async () => {
    const { createApp } = await import('../server');
    app = createApp();
  });

  afterEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  describe('POST /api/auth/register', () => {
    it('should register a new user with valid credentials', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'newuser@example.com',
          password: 'SecurePass123!',
          name: 'Test User',
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('token');
      expect(response.body.user.email).toBe('newuser@example.com');
    });

    it('should reject invalid email', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'invalid-email',
          password: 'SecurePass123!',
          name: 'Test User',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('email');
    });

    it('should reject weak password', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'user@example.com',
          password: 'weak',
          name: 'Test User',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.toLowerCase()).toContain('password');
    });

    it('should reject duplicate email', async () => {
      // First registration
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'duplicate@example.com',
          password: 'SecurePass123!',
          name: 'User One',
        });

      // Second registration with same email
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'duplicate@example.com',
          password: 'SecurePass123!',
          name: 'User Two',
        });

      expect(response.status).toBe(409);
      expect(response.body.error).toContain('already registered');
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      // Create a test user
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'login@example.com',
          password: 'SecurePass123!',
          name: 'Login Test',
        });
    });

    it('should login with valid credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'login@example.com',
          password: 'SecurePass123!',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('token');
    });

    it('should reject invalid password', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'login@example.com',
          password: 'WrongPassword',
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Invalid email or password');
    });

    it('should reject non-existent user', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'SecurePass123!',
        });

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/auth/password-reset-request', () => {
    beforeEach(async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'reset@example.com',
          password: 'SecurePass123!',
          name: 'Reset Test',
        });
    });

    it('should request password reset for existing user', async () => {
      const response = await request(app)
        .post('/api/auth/password-reset-request')
        .send({ email: 'reset@example.com' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message');
    });

    it('should not reveal if email exists (security)', async () => {
      const response = await request(app)
        .post('/api/auth/password-reset-request')
        .send({ email: 'nonexistent@example.com' });

      // Same response as valid user (security: don't leak user existence)
      expect(response.status).toBe(200);
    });
  });
});
