const { z } = require("zod");

// Factory para crear middleware de validación
const validate = (schema) => (req, res, next) => {
  try {
    schema.parse({
      body: req.body,
      query: req.query,
      params: req.params,
    });
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: "Error de validación",
        details: error.errors.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        })),
      });
    }
    next(error);
  }
};

// Schemas comunes
const paginationSchema = z.object({
  query: z.object({
    page: z.string().optional().transform((val) => parseInt(val || "1", 10)),
    limit: z.string().optional().transform((val) => parseInt(val || "20", 10)),
    sortBy: z.string().optional(),
    sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
  }),
});

const idParamSchema = z.object({
  params: z.object({
    id: z.string().uuid("ID inválido"),
  }),
});

module.exports = {
  validate,
  paginationSchema,
  idParamSchema,
};

