module.exports = {
  apps: [
    {
      name: "telegram-boutique-pro",
      script: ".output/server/index.mjs",
      cwd: "/var/www/app",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        HOST: "127.0.0.1",
      },
    },
  ],
};