// prisma/seed.js
(async () => {
  try {
    // Ejecuta seeds en el orden que necesites:
    await import("./seed-settings.js");
    await import("./seed-email-templates.js");
    await import("./seed-campaigns.js");
    // await import("./seed-test.js"); // si aplica

    console.log(" Seed completed");
    process.exit(0);
  } catch (err) {
    console.error(" Seed failed:", err);
    process.exit(1);
  }
})();
