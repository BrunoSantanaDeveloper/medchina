module.exports = {
  preset: "jest-expo",
  testMatch: ["<rootDir>/**/*.test.{ts,tsx}"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  clearMocks: true,
};
