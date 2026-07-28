export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.js'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.d.ts',
    '!src/scripts/**',
  ],
  coverageThreshold: {
    global: {
      branches: 30,
      functions: 30,
      lines: 30,
      statements: 30,
    },
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        allowJs: true,
        esModuleInterop: true,
      }
    }],
  },
};
