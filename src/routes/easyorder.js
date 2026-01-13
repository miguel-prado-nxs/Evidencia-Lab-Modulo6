const express = require("express");
const router = express.Router();
const axios = require("axios");
const restaurantProfileController = require("../controllers/restaurantProfileController");
const { authenticateJWTOrServiceKey } = require("../middleware/auth");
const logger = require("../config/logger");
const multer = require("multer");
const uploadMemory = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const POS_API_BASE_URL =
  process.env.POS_API_BASE_URL ||
  "";
const POS_API_TOKEN =
  process.env.POS_API_TOKEN ||
  "";

// Helper para proxies a POS
const proxyToPOS = (method = "get") => async (req, res, next) => {
  try {
    const { url, data } = req.pos || {};
    if (!url) return res.status(500).json({ success: false, error: "URL no configurada" });

    const config = {
      method,
      url,
      headers: { Authorization: `Bearer ${POS_API_TOKEN}`, 'Content-Type': 'application/json' },
    };
    if (data) config.data = data;

    const { data: responseData } = await axios(config);
    res.status(method === "post" ? 201 : 200).json(responseData);
  } catch (error) {
    logger.error(`[Proxy ${req.pos?.name}] Error:`, error?.response?.data || error.message);
    res.status(error?.response?.status || 500).json({
      success: false,
      error: error?.response?.data?.error || error.message || "Error en proxy",
    });
  }
};

// PASO 1: PERFIL DE RESTAURANTE
router.get("/ventas/restaurant-profiles/:establishmentId", authenticateJWTOrServiceKey, restaurantProfileController.getProfile);

router.post("/ventas/restaurant-profiles", authenticateJWTOrServiceKey, uploadMemory.single("logo"), restaurantProfileController.upsertProfile);

// PASO 2: SUCURSALES
router.get("/ventas/restaurantes/:restauranteId/sucursales", authenticateJWTOrServiceKey, async (req, res) => {
  try {
    const { data } = await axios.get(`${POS_API_BASE_URL}/api/sucursales/v1/restaurante/${req.params.restauranteId}`,
      { headers: { Authorization: `Bearer ${POS_API_TOKEN}` } });
    res.json(data);
  } catch (error) {
    logger.error("[Sucursales GET]", error.message);
    res.status(error?.response?.status || 500).json({ success: false, error: error.message });
  }
});

router.post("/ventas/sucursales", authenticateJWTOrServiceKey, async (req, res) => {
  try {
    const { data } = await axios.post(`${POS_API_BASE_URL}/api/sucursales/v1`, req.body,
      { headers: { Authorization: `Bearer ${POS_API_TOKEN}`, 'Content-Type': 'application/json' } });
    res.status(201).json(data);
  } catch (error) {
    logger.error("[Sucursales POST]", error.message);
    res.status(error?.response?.status || 500).json({ success: false, error: error.message });
  }
});

router.put("/ventas/sucursales/:id", authenticateJWTOrServiceKey, async (req, res) => {
  try {
    const { data } = await axios.put(`${POS_API_BASE_URL}/api/sucursales/v1/${req.params.id}`, req.body,
      { headers: { Authorization: `Bearer ${POS_API_TOKEN}`, 'Content-Type': 'application/json' } });
    res.json(data);
  } catch (error) {
    logger.error("[Sucursales PUT]", error.message);
    res.status(error?.response?.status || 500).json({ success: false, error: error.message });
  }
});

// PASO 2: SALAS
router.get("/ventas/sucursales/:sucursalId/salas", authenticateJWTOrServiceKey, async (req, res) => {
  try {
    const { data } = await axios.get(`${POS_API_BASE_URL}/api/salas/v1/sucursal/${req.params.sucursalId}`,
      { headers: { Authorization: `Bearer ${POS_API_TOKEN}` } });
    res.json(data);
  } catch (error) {
    logger.error("[Salas GET]", error.message);
    res.status(error?.response?.status || 500).json({ success: false, error: error.message });
  }
});

router.post("/ventas/salas", authenticateJWTOrServiceKey, async (req, res) => {
  try {
    const { data } = await axios.post(`${POS_API_BASE_URL}/api/salas/v1`, req.body,
      { headers: { Authorization: `Bearer ${POS_API_TOKEN}`, 'Content-Type': 'application/json' } });
    res.status(201).json(data);
  } catch (error) {
    logger.error("[Salas POST]", error.message);
    res.status(error?.response?.status || 500).json({ success: false, error: error.message });
  }
});

// PASO 2: MESAS
router.get("/ventas/sucursales/:sucursalId/mesas", authenticateJWTOrServiceKey, async (req, res) => {
  try {
    const { data } = await axios.get(`${POS_API_BASE_URL}/api/mesas/v1/sucursal/${req.params.sucursalId}`,
      { headers: { Authorization: `Bearer ${POS_API_TOKEN}` } });
    res.json(data);
  } catch (error) {
    logger.error("[Mesas GET]", error.message);
    res.status(error?.response?.status || 500).json({ success: false, error: error.message });
  }
});

router.post("/ventas/mesas", authenticateJWTOrServiceKey, async (req, res) => {
  try {
    const { data } = await axios.post(`${POS_API_BASE_URL}/api/mesas/v1`, req.body,
      { headers: { Authorization: `Bearer ${POS_API_TOKEN}`, 'Content-Type': 'application/json' } });
    res.status(201).json(data);
  } catch (error) {
    logger.error("[Mesas POST]", error.message);
    res.status(error?.response?.status || 500).json({ success: false, error: error.message });
  }
});

// PASO 3: MENÚS
router.get("/ventas/sucursales/:sucursalId/menus", authenticateJWTOrServiceKey, async (req, res) => {
  try {
    const { data } = await axios.get(`${POS_API_BASE_URL}/api/sucursales/v1/${req.params.sucursalId}/menus`,
      { headers: { Authorization: `Bearer ${POS_API_TOKEN}` } });
    res.json(data);
  } catch (error) {
    logger.error("[Menús GET]", error.message);
    res.status(error?.response?.status || 500).json({ success: false, error: error.message });
  }
});

router.post("/ventas/menus", authenticateJWTOrServiceKey, async (req, res) => {
  try {
    const { data } = await axios.post(`${POS_API_BASE_URL}/api/menus/v1`, req.body,
      { headers: { Authorization: `Bearer ${POS_API_TOKEN}`, 'Content-Type': 'application/json' } });
    res.status(201).json(data);
  } catch (error) {
    logger.error("[Menús POST]", error.message);
    res.status(error?.response?.status || 500).json({ success: false, error: error.message });
  }
});

router.put("/ventas/menus/:id", authenticateJWTOrServiceKey, async (req, res) => {
  try {
    const { data } = await axios.put(`${POS_API_BASE_URL}/api/menus/v1/${req.params.id}`, req.body,
      { headers: { Authorization: `Bearer ${POS_API_TOKEN}`, 'Content-Type': 'application/json' } });
    res.json(data);
  } catch (error) {
    logger.error("[Menús PUT]", error.message);
    res.status(error?.response?.status || 500).json({ success: false, error: error.message });
  }
});

// PASO 3: CATEGORÍAS
router.get("/ventas/categorias", authenticateJWTOrServiceKey, async (req, res) => {
  try {
    const { data } = await axios.get(`${POS_API_BASE_URL}/api/categorias/v1`,
      { headers: { Authorization: `Bearer ${POS_API_TOKEN}` } });
    res.json(data);
  } catch (error) {
    logger.error("[Categorías GET]", error.message);
    res.status(error?.response?.status || 500).json({ success: false, error: error.message });
  }
});

router.post("/ventas/categorias", authenticateJWTOrServiceKey, async (req, res) => {
  try {
    const { data } = await axios.post(`${POS_API_BASE_URL}/api/categorias/v1`, req.body,
      { headers: { Authorization: `Bearer ${POS_API_TOKEN}`, 'Content-Type': 'application/json' } });
    res.status(201).json(data);
  } catch (error) {
    logger.error("[Categorías POST]", error.message);
    res.status(error?.response?.status || 500).json({ success: false, error: error.message });
  }
});

// PASO 3: MENU ITEMS
router.get("/ventas/sucursales/:sucursalId/menu-items", authenticateJWTOrServiceKey, async (req, res) => {
  try {
    const { data } = await axios.get(`${POS_API_BASE_URL}/api/menuitems/v1/sucursal/${req.params.sucursalId}`,
      { headers: { Authorization: `Bearer ${POS_API_TOKEN}` } });
    res.json(data);
  } catch (error) {
    logger.error("[MenuItems GET]", error.message);
    res.status(error?.response?.status || 500).json({ success: false, error: error.message });
  }
});

router.post("/ventas/menu-items", authenticateJWTOrServiceKey, async (req, res) => {
  try {
    const { data } = await axios.post(`${POS_API_BASE_URL}/api/menuitems/v1`, req.body,
      { headers: { Authorization: `Bearer ${POS_API_TOKEN}`, 'Content-Type': 'application/json' } });
    res.status(201).json(data);
  } catch (error) {
    logger.error("[MenuItems POST]", error.message);
    res.status(error?.response?.status || 500).json({ success: false, error: error.message });
  }
});

router.put("/ventas/menu-items/:id", authenticateJWTOrServiceKey, async (req, res) => {
  try {
    const { data } = await axios.put(`${POS_API_BASE_URL}/api/menuitems/v1/${req.params.id}`, req.body,
      { headers: { Authorization: `Bearer ${POS_API_TOKEN}`, 'Content-Type': 'application/json' } });
    res.json(data);
  } catch (error) {
    logger.error("[MenuItems PUT]", error.message);
    res.status(error?.response?.status || 500).json({ success: false, error: error.message });
  }
});

// RELACIONES MENÚ-ITEMS
router.post("/ventas/menus/:menuId/items", authenticateJWTOrServiceKey, async (req, res) => {
  try {
    const { data } = await axios.post(`${POS_API_BASE_URL}/api/menus/v1/${req.params.menuId}/menu-items`, req.body,
      { headers: { Authorization: `Bearer ${POS_API_TOKEN}`, 'Content-Type': 'application/json' } });
    res.json(data);
  } catch (error) {
    logger.error("[Menú-Items]", error.message);
    res.status(error?.response?.status || 500).json({ success: false, error: error.message });
  }
});

module.exports = router;

