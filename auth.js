const { betterAuth } = require("better-auth");
const { mongodbAdapter } = require("better-auth/adapters/mongodb");

const initAuth = (mongoClient) => {
  const db = mongoClient.db("medicareConnect");

  return betterAuth({
    database: mongodbAdapter(db, { client: mongoClient }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 6,
    },
    // ✅ Use schema extension instead of databaseHooks
    user: {
      fields: {
        role: "role",
        status: "status",
      },
    },
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      },
    },
    trustedOrigins: [process.env.CLIENT_URL || "http://localhost:3000"],
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.SERVER_URL || "http://localhost:5000",
  });
};

module.exports = initAuth;