"use strict";

const Hapi = require("@hapi/hapi");
const HapiJwt = require("@hapi/jwt");
const dotenv = require("dotenv");

const authHandlers = require("./handlers/authHandlers");
const transactionHandlers = require("./handlers/transactionHandler");
const goalHandlers = require("./handlers/goalHandler");
const db = require("./database/db");
const axios = require("axios");

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET_KEY;

if (!JWT_SECRET) {
  console.error(
    "FATAL ERROR: JWT_SECRET_KEY tidak di-set di environment variables.",
  );
  process.exit(1);
}

const init = async () => {
  const port = process.env.PORT || process.env.NODE_PORT || 3000;
  const host = process.env.NODE_ENV === "production" ? "0.0.0.0" : "localhost";

  const server = Hapi.server({
    port,
    host,
    routes: {
      cors: {
        origin: ["*"], // atau ["http://localhost:5173"] untuk dev, "*" untuk semua origin
        credentials: true,
      },
    },
  });

  await server.register(HapiJwt);
  server.auth.strategy("jwt_strategy", "jwt", {
    keys: JWT_SECRET,
    verify: {
      aud: false,
      iss: false,
      sub: false,
      exp: true,
      nbf: true,
      maxAgeSec: 14400,
    },
    validate: async (artifacts, request, h) => {
      try {
        const { id, username } = artifacts.decoded.payload;
        const userQuery =
          "SELECT id, username FROM users WHERE id = $1 AND username = $2";
        const { rows } = await db.query(userQuery, [id, username]);
        if (rows.length === 0) {
          return { isValid: false };
        }
        return { isValid: true, credentials: { user: rows[0] } };
      } catch (dbError) {
        console.error(
          "Error saat validasi token di database (JWT strategy):",
          dbError,
        );
        return { isValid: false };
      }
    },
  });

  const routes = [
    {
      method: "POST",
      path: "/register",
      config: { auth: false },
      handler: authHandlers.registerHandler,
    },
    {
      method: "GET",
      path: "/me",
      config: { auth: "jwt_strategy" },
      handler: authHandlers.getProfileHandler,
    },
    {
      method: "POST",
      path: "/login",
      config: { auth: false },
      handler: authHandlers.loginHandler,
    },
    {
      method: "PUT",
      path: "/update-password",
      config: { auth: "jwt_strategy" },
      handler: authHandlers.updatePasswordHandler,
    },
    {
      method: "DELETE",
      path: "/delete-user",
      config: { auth: "jwt_strategy" },
      handler: authHandlers.deleteUserHandler,
    },
    {
      method: "GET",
      path: "/protected-data",
      config: { auth: "jwt_strategy" },
      handler: (request, h) => {
        const userInfo = request.auth.credentials.user;
        return { message: "Ini adalah data yang dilindungi.", user: userInfo };
      },
    },
    {
      method: "POST",
      path: "/transactions",
      config: { auth: "jwt_strategy" },
      handler: transactionHandlers.createTransactionHandler,
    },
    {
      method: "GET",
      path: "/transactions",
      config: { auth: "jwt_strategy" },
      handler: transactionHandlers.getAllTransactionsHandler,
    },
    {
      method: "POST",
      path: "/goals",
      config: { auth: "jwt_strategy" },
      handler: goalHandlers.createGoalHandler,
    },
    {
      method: "GET",
      path: "/goals",
      config: { auth: "jwt_strategy" },
      handler: goalHandlers.getAllGoalsHandler,
    },
    {
      method: "PUT",
      path: "/goals/{id}",
      config: { auth: "jwt_strategy" },
      handler: goalHandlers.updateGoalHandler,
    },
    {
      method: "DELETE",
      path: "/goals/{id}",
      config: { auth: "jwt_strategy" },
      handler: goalHandlers.deleteGoalHandler,
    },
    {
      method: "GET",
      path: "/transactions/prediction",
      config: { auth: "jwt_strategy" },
      handler: transactionHandlers.getExpensePredictionHandler,
    },
    {
      method: "PUT",
      path: "/transactions/{id}/categorize",
      handler: transactionHandlers.categorizeSingleTransactionHandler,
      options: {
        auth: "jwt_strategy",
      },
    },
    {
      method: "POST",
      path: "/transactions/categorize-all",
      handler: transactionHandlers.categorizeAllTransactionsHandler,
      options: {
        auth: "jwt_strategy",
      },
    },
  ];

  server.route(routes);

  await server.start();
  console.log("Server Hapi.js berjalan di %s", server.info.uri);
};

process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err);
  process.exit(1);
});

init();
