/**
 * Twenty CRM Service
 * Cliente HTTP para interactuar con la API REST de Twenty CRM
 * 
 * Basado en easyorder-analytics-api/src/services/twentyService.js
 * 
 * Endpoints principales:
 * - /companies -> Establecimientos
 * - /contactos -> Contactos
 * - /prospectos -> Prospectos
 * - /opportunities -> Leads/Oportunidades
 * - /clientes -> Clientes
 */

const axios = require("axios");
const config = require("../../config/env");
const logger = require("../../config/logger");

class TwentyService {
  constructor() {
    this.baseUrl = config.twenty.baseUrl;
    this.apiKey = config.twenty.apiKey;
    
    if (!this.apiKey) {
      logger.warn("[TwentyService] TWENTY_API_KEY no configurada - servicio deshabilitado");
    }
    
    this.client = axios.create({
      baseURL: `${this.baseUrl}/rest`,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });
  }

  /**
   * Verifica si el servicio esta habilitado
   */
  isEnabled() {
    return !!this.apiKey && config.twenty.syncEnabled;
  }

  // ============================================================
  // ESTABLECIMIENTO (Company)
  // ============================================================

  /**
   * Crear un establecimiento (company) en Twenty
   */
  async createEstablecimiento(data) {
    try {
      const response = await this.client.post("/companies", data);
      const created = response.data.data?.createCompany || response.data;
      logger.info(`[TwentyService] Establecimiento creado: ${created.id}`, {
        name: data.name,
        twentyId: created.id,
      });
      return created;
    } catch (error) {
      logger.error("[TwentyService] Error creando establecimiento:", {
        error: error.response?.data || error.message,
        data: { name: data.name },
      });
      throw error;
    }
  }

  /**
   * Actualizar un establecimiento existente
   */
  async updateEstablecimiento(establecimientoId, data) {
    try {
      const response = await this.client.patch(`/companies/${establecimientoId}`, data);
      const updated = response.data.data?.updateCompany || response.data;
      logger.info(`[TwentyService] Establecimiento actualizado: ${establecimientoId}`, {
        twentyId: establecimientoId,
      });
      return updated;
    } catch (error) {
      logger.error("[TwentyService] Error actualizando establecimiento:", {
        error: error.response?.data || error.message,
        establecimientoId,
      });
      throw error;
    }
  }

  /**
   * Buscar establecimiento por email con paginacion
   */
  async findEstablecimientoByEmail(email) {
    if (!email) return null;
    
    try {
      const limit = 200;
      const maxPages = 50;
      let currentPage = 0;
      let startingAfter = null;

      while (currentPage < maxPages) {
        const params = {
          limit,
          order_by: "updatedAt[DescNullsLast]",
        };

        if (startingAfter) {
          params.starting_after = startingAfter;
        }

        const response = await this.client.get("/companies", { params });
        const companies = response.data.data?.companies || response.data.data || [];

        if (companies.length === 0) break;

        const found = companies.find(
          (c) =>
            c.emailDenue?.primaryEmail &&
            c.emailDenue.primaryEmail.trim().toLowerCase() === email.trim().toLowerCase()
        );

        if (found) {
          logger.info(`[TwentyService] Establecimiento encontrado por email: ${found.id}`);
          return found;
        }

        if (companies.length < limit) break;

        startingAfter = companies[companies.length - 1].id;
        currentPage++;
      }

      return null;
    } catch (error) {
      if (
        error.response?.data?.error === "BadRequestException" &&
        error.response?.data?.messages?.some((m) => m.includes("Invalid cursor"))
      ) {
        logger.warn("[TwentyService] Cursor invalido en busqueda de establecimiento");
        return null;
      }
      logger.error("[TwentyService] Error buscando establecimiento por email:", {
        error: error.response?.data || error.message,
      });
      return null;
    }
  }

  /**
   * Buscar establecimiento por telefono
   */
  async findEstablecimientoByPhone(phone) {
    if (!phone) return null;
    
    try {
      const response = await this.client.get("/companies", { params: { limit: 200 } });
      const companies = response.data.data?.companies || response.data.data || [];

      const normalizedPhone = (phone || "").replace(/\D/g, "");
      const found = companies.find(
        (c) =>
          c.telefonoDenue?.primaryPhoneNumber &&
          c.telefonoDenue.primaryPhoneNumber.replace(/\D/g, "") === normalizedPhone
      );

      if (found) {
        logger.info(`[TwentyService] Establecimiento encontrado por telefono: ${found.id}`);
      }

      return found || null;
    } catch (error) {
      logger.error("[TwentyService] Error buscando establecimiento por telefono:", {
        error: error.response?.data || error.message,
      });
      return null;
    }
  }

  /**
   * Buscar establecimiento por clave DENUE (ID del establecimiento)
   */
  async findEstablecimientoByClaveDenue(claveDenue) {
    if (!claveDenue) return null;
    
    try {
      const response = await this.client.get("/companies", { 
        params: { 
          limit: 200,
          filter: `claveDenue[eq]:${claveDenue}`
        } 
      });
      const companies = response.data.data?.companies || response.data.data || [];

      const found = companies.find(
        (c) => c.claveDenue === claveDenue || c.claveDenue === String(claveDenue)
      );

      if (found) {
        logger.info(`[TwentyService] Establecimiento encontrado por claveDenue: ${found.id}`);
      }

      return found || null;
    } catch (error) {
      // Si el filtro no funciona, hacer busqueda manual
      if (error.response?.status === 400) {
        try {
          const response = await this.client.get("/companies", { params: { limit: 200 } });
          const companies = response.data.data?.companies || response.data.data || [];
          const found = companies.find(
            (c) => c.claveDenue === claveDenue || c.claveDenue === String(claveDenue)
          );
          if (found) {
            logger.info(`[TwentyService] Establecimiento encontrado por claveDenue (manual): ${found.id}`);
          }
          return found || null;
        } catch (innerError) {
          logger.error("[TwentyService] Error buscando establecimiento por claveDenue (manual):", {
            error: innerError.response?.data || innerError.message,
          });
          return null;
        }
      }
      logger.error("[TwentyService] Error buscando establecimiento por claveDenue:", {
        error: error.response?.data || error.message,
      });
      return null;
    }
  }

  // ============================================================
  // CONTACTO
  // ============================================================

  /**
   * Crear un contacto en Twenty
   */
  async createContacto(data) {
    try {
      const response = await this.client.post("/contactos", data);
      const created = response.data.data?.createContacto || response.data;
      logger.info(`[TwentyService] Contacto creado: ${created.id}`, {
        name: data.name,
        twentyId: created.id,
      });
      return created;
    } catch (error) {
      logger.error("[TwentyService] Error creando contacto:", {
        error: error.response?.data || error.message,
        data: { name: data.name },
      });
      throw error;
    }
  }

  /**
   * Actualizar un contacto existente
   */
  async updateContacto(contactoId, data) {
    try {
      const response = await this.client.patch(`/contactos/${contactoId}`, data);
      const updated = response.data.data?.updateContacto || response.data;
      logger.info(`[TwentyService] Contacto actualizado: ${contactoId}`);
      return updated;
    } catch (error) {
      logger.error("[TwentyService] Error actualizando contacto:", {
        error: error.response?.data || error.message,
        contactoId,
      });
      throw error;
    }
  }

  /**
   * Eliminar contacto por ID
   */
  async deleteContacto(contactoId) {
    try {
      await this.client.delete(`/contactos/${contactoId}`);
      logger.info(`[TwentyService] Contacto eliminado: ${contactoId}`);
      return true;
    } catch (error) {
      logger.error("[TwentyService] Error eliminando contacto:", {
        error: error.response?.data || error.message,
        contactoId,
      });
      throw error;
    }
  }

  /**
   * Eliminar prospecto por ID
   */
  async deleteProspecto(prospectoId) {
    try {
      await this.client.delete(`/prospectos/${prospectoId}`);
      logger.info(`[TwentyService] Prospecto eliminado: ${prospectoId}`);
      return true;
    } catch (error) {
      logger.error("[TwentyService] Error eliminando prospecto:", {
        error: error.response?.data || error.message,
        prospectoId,
      });
      throw error;
    }
  }

  /**
   * Eliminar opportunity por ID
   */
  async deleteOpportunity(opportunityId) {
    try {
      await this.client.delete(`/opportunities/${opportunityId}`);
      logger.info(`[TwentyService] Opportunity eliminado: ${opportunityId}`);
      return true;
    } catch (error) {
      logger.error("[TwentyService] Error eliminando opportunity:", {
        error: error.response?.data || error.message,
        opportunityId,
      });
      throw error;
    }
  }

  /**
   * Buscar contacto por email con paginacion
   */
  async findContactoByEmail(email) {
    if (!email) return null;
    
    try {
      const limit = 200;
      const maxPages = 50;
      let currentPage = 0;
      let startingAfter = null;

      while (currentPage < maxPages) {
        const params = {
          limit,
          order_by: "updatedAt[DescNullsLast]",
        };

        if (startingAfter) {
          params.starting_after = startingAfter;
        }

        const response = await this.client.get("/contactos", { params });
        const contactos = response.data.data?.contactos || response.data.data || [];

        if (contactos.length === 0) break;

        const found = contactos.find(
          (c) =>
            c.emailPrincipal?.primaryEmail &&
            c.emailPrincipal.primaryEmail.trim().toLowerCase() === email.trim().toLowerCase()
        );

        if (found) {
          logger.info(`[TwentyService] Contacto encontrado por email: ${found.id}`);
          return found;
        }

        if (contactos.length < limit) break;

        startingAfter = contactos[contactos.length - 1].id;
        currentPage++;
      }

      return null;
    } catch (error) {
      logger.error("[TwentyService] Error buscando contacto por email:", {
        error: error.response?.data || error.message,
      });
      return null;
    }
  }

  /**
   * Buscar contacto por telefono
   */
  async findContactoByPhone(phone) {
    if (!phone) return null;
    
    try {
      const response = await this.client.get("/contactos", { params: { limit: 200 } });
      const contactos = response.data.data?.contactos || response.data.data || [];

      const normalizedPhone = (phone || "").replace(/\D/g, "");
      const found = contactos.find(
        (c) =>
          c.telefonoPrincipal?.primaryPhoneNumber &&
          c.telefonoPrincipal.primaryPhoneNumber.replace(/\D/g, "") === normalizedPhone
      );

      if (found) {
        logger.info(`[TwentyService] Contacto encontrado por telefono: ${found.id}`);
      }

      return found || null;
    } catch (error) {
      logger.error("[TwentyService] Error buscando contacto por telefono:", {
        error: error.response?.data || error.message,
      });
      return null;
    }
  }

  /**
   * Buscar contacto por establecimientoId
   */
  async findContactoByEstablecimientoId(establecimientoId) {
    if (!establecimientoId) return null;
    
    try {
      const response = await this.client.get("/contactos", { params: { limit: 200 } });
      const contactos = response.data.data?.contactos || response.data.data || [];

      const found = contactos.find((c) => c.establecimientoId === establecimientoId);

      if (found) {
        logger.info(`[TwentyService] Contacto encontrado por establecimientoId: ${found.id}`);
      }

      return found || null;
    } catch (error) {
      logger.error("[TwentyService] Error buscando contacto por establecimientoId:", {
        error: error.response?.data || error.message,
      });
      return null;
    }
  }

  // ============================================================
  // PROSPECTO
  // ============================================================

  /**
   * Crear un prospecto en Twenty
   */
  async createProspecto(data) {
    try {
      const response = await this.client.post("/prospectos", data);
      const created = response.data.data?.createProspecto || response.data;
      logger.info(`[TwentyService] Prospecto creado: ${created.id}`, {
        twentyId: created.id,
      });
      return created;
    } catch (error) {
      logger.error("[TwentyService] Error creando prospecto:", {
        error: error.response?.data || error.message,
      });
      throw error;
    }
  }

  /**
   * Actualizar un prospecto existente
   */
  async updateProspecto(prospectoId, data) {
    try {
      const response = await this.client.patch(`/prospectos/${prospectoId}`, data);
      const updated = response.data.data?.updateProspecto || response.data;
      logger.info(`[TwentyService] Prospecto actualizado: ${prospectoId}`);
      return updated;
    } catch (error) {
      logger.error("[TwentyService] Error actualizando prospecto:", {
        error: error.response?.data || error.message,
        prospectoId,
      });
      throw error;
    }
  }

  /**
   * Eliminar prospecto por ID
   */
  async deleteProspecto(prospectoId) {
    try {
      await this.client.delete(`/prospectos/${prospectoId}`);
      logger.info(`[TwentyService] Prospecto eliminado: ${prospectoId}`);
      return true;
    } catch (error) {
      logger.error("[TwentyService] Error eliminando prospecto:", {
        error: error.response?.data || error.message,
        prospectoId,
      });
      throw error;
    }
  }

  /**
   * Buscar prospecto por email con paginacion
   */
  async findProspectoByEmail(email) {
    if (!email) return null;
    
    try {
      const limit = 200;
      const maxPages = 50;
      let currentPage = 0;
      let startingAfter = null;

      while (currentPage < maxPages) {
        const params = {
          limit,
          order_by: "updatedAt[DescNullsLast]",
        };

        if (startingAfter) {
          params.starting_after = startingAfter;
        }

        const response = await this.client.get("/prospectos", { params });
        const prospectos = response.data.data?.prospectos || response.data.data || [];

        if (prospectos.length === 0) break;

        const found = prospectos.find(
          (p) =>
            p.tomadorEmail?.primaryEmail &&
            p.tomadorEmail.primaryEmail.trim().toLowerCase() === email.trim().toLowerCase()
        );

        if (found) {
          logger.info(`[TwentyService] Prospecto encontrado por email: ${found.id}`);
          return found;
        }

        if (prospectos.length < limit) break;

        startingAfter = prospectos[prospectos.length - 1].id;
        currentPage++;
      }

      return null;
    } catch (error) {
      logger.error("[TwentyService] Error buscando prospecto por email:", {
        error: error.response?.data || error.message,
      });
      return null;
    }
  }

  /**
   * Buscar prospecto por establecimientoId
   */
  async findProspectoByEstablecimientoId(establecimientoId) {
    if (!establecimientoId) return null;
    
    try {
      const response = await this.client.get("/prospectos", { params: { limit: 200 } });
      const prospectos = response.data.data?.prospectos || response.data.data || [];

      const found = prospectos.find((p) => p.establecimientoId === establecimientoId);

      if (found) {
        logger.info(`[TwentyService] Prospecto encontrado por establecimientoId: ${found.id}`);
      }

      return found || null;
    } catch (error) {
      logger.error("[TwentyService] Error buscando prospecto por establecimientoId:", {
        error: error.response?.data || error.message,
      });
      return null;
    }
  }

  // ============================================================
  // OPPORTUNITY (Lead)
  // ============================================================

  /**
   * Crear una oportunidad (lead) en Twenty
   */
  async createOpportunity(data) {
    try {
      const response = await this.client.post("/opportunities", data);
      const created = response.data.data?.createOpportunity || response.data;
      logger.info(`[TwentyService] Opportunity creada: ${created.id}`, {
        name: data.name,
        twentyId: created.id,
      });
      return created;
    } catch (error) {
      logger.error("[TwentyService] Error creando opportunity:", {
        error: error.response?.data || error.message,
        data: { name: data.name },
      });
      throw error;
    }
  }

  /**
   * Actualizar una oportunidad existente
   */
  async updateOpportunity(opportunityId, data) {
    try {
      const response = await this.client.patch(`/opportunities/${opportunityId}`, data);
      const updated = response.data.data?.updateOpportunity || response.data;
      logger.info(`[TwentyService] Opportunity actualizada: ${opportunityId}`);
      return updated;
    } catch (error) {
      logger.error("[TwentyService] Error actualizando opportunity:", {
        error: error.response?.data || error.message,
        opportunityId,
      });
      throw error;
    }
  }

  /**
   * Buscar opportunity por establecimientoId y prospectoId
   */
  async findOpportunityByEstablecimientoAndProspecto(establecimientoId, prospectoId) {
    try {
      const response = await this.client.get("/opportunities", { params: { limit: 200 } });
      const opportunities = response.data.data?.opportunities || response.data.data || [];

      const found = opportunities.find(
        (o) => o.establecimientoId === establecimientoId && o.prospectoId === prospectoId
      );

      if (found) {
        logger.info(`[TwentyService] Opportunity encontrada: ${found.id}`);
      }

      return found || null;
    } catch (error) {
      logger.error("[TwentyService] Error buscando opportunity:", {
        error: error.response?.data || error.message,
      });
      return null;
    }
  }

  /**
   * Buscar opportunity por establecimientoId
   */
  async findOpportunityByEstablecimientoId(establecimientoId) {
    if (!establecimientoId) return null;
    
    try {
      const response = await this.client.get("/opportunities", { params: { limit: 200 } });
      const opportunities = response.data.data?.opportunities || response.data.data || [];

      const found = opportunities.find((o) => o.establecimientoId === establecimientoId);

      if (found) {
        logger.info(`[TwentyService] Opportunity encontrada por establecimientoId: ${found.id}`);
      }

      return found || null;
    } catch (error) {
      logger.error("[TwentyService] Error buscando opportunity por establecimientoId:", {
        error: error.response?.data || error.message,
      });
      return null;
    }
  }

  // ============================================================
  // CLIENTE
  // ============================================================

  /**
   * Crear un cliente en Twenty
   */
  async createCliente(data) {
    try {
      const response = await this.client.post("/clientes", data);
      const created = response.data.data?.createCliente || response.data;
      logger.info(`[TwentyService] Cliente creado: ${created.id}`, {
        name: data.name,
        twentyId: created.id,
      });
      return created;
    } catch (error) {
      logger.error("[TwentyService] Error creando cliente:", {
        error: error.response?.data || error.message,
        data: { name: data.name },
      });
      throw error;
    }
  }

  /**
   * Actualizar un cliente existente
   */
  async updateCliente(clienteId, data) {
    try {
      const response = await this.client.patch(`/clientes/${clienteId}`, data);
      const updated = response.data.data?.updateCliente || response.data;
      logger.info(`[TwentyService] Cliente actualizado: ${clienteId}`);
      return updated;
    } catch (error) {
      logger.error("[TwentyService] Error actualizando cliente:", {
        error: error.response?.data || error.message,
        clienteId,
      });
      throw error;
    }
  }

  /**
   * Buscar cliente por establecimientoId
   */
  async findClienteByEstablecimientoId(establecimientoId) {
    if (!establecimientoId) return null;
    
    try {
      const response = await this.client.get("/clientes", { params: { limit: 200 } });
      const clientes = response.data.data?.clientes || response.data.data || [];

      const found = clientes.find((c) => c.establecimientoId === establecimientoId);

      if (found) {
        logger.info(`[TwentyService] Cliente encontrado por establecimientoId: ${found.id}`);
      }

      return found || null;
    } catch (error) {
      logger.error("[TwentyService] Error buscando cliente por establecimientoId:", {
        error: error.response?.data || error.message,
      });
      return null;
    }
  }

  // ============================================================
  // HEALTH CHECK
  // ============================================================

  /**
   * Verificar conectividad con Twenty
   */
  async healthCheck() {
    try {
      const response = await this.client.get("/companies", { params: { limit: 1 } });
      return {
        status: "ok",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: "error",
        error: error.response?.data || error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}

// Singleton
const twentyService = new TwentyService();

module.exports = twentyService;
