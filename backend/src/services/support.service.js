/**
 * SupportService — customer support ticket system.
 *
 * Manages support tickets with:
 *   - Auto-categorization (order, payment, delivery, product, other)
 *   - Priority assignment (low, medium, high, urgent)
 *   - Status lifecycle (open → in_progress → resolved → closed)
 *   - Internal notes (staff-only)
 *   - Customer satisfaction rating
 */

import { serializeList } from '../utils/serialize.js';
import { notFound, badRequest } from '../utils/ApiError.js';

const TICKET_STATUS = ['open', 'in_progress', 'resolved', 'closed'];
const TICKET_PRIORITY = ['low', 'medium', 'high', 'urgent'];
const TICKET_CATEGORY = ['order', 'payment', 'delivery', 'product', 'account', 'other'];

// In-memory ticket store (replace with MongoDB model in production)
const tickets = new Map();
let ticketCounter = 1;

class SupportService {
  async create({ tenantId, userId, payload }) {
    const { subject, description, category, orderId, priority } = payload;

    const id = `TKT-${String(ticketCounter++).padStart(6, '0')}`;
    const ticket = {
      id,
      tenantId,
      userId,
      subject: subject || 'Support request',
      description: description || '',
      category: TICKET_CATEGORY.includes(category) ? category : 'other',
      priority: TICKET_PRIORITY.includes(priority) ? priority : 'medium',
      status: 'open',
      orderId: orderId || null,
      messages: [{
        sender: 'customer',
        userId,
        message: description || subject || '',
        timestamp: new Date(),
      }],
      internalNotes: [],
      satisfaction: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      resolvedAt: null,
      closedAt: null,
    };

    tickets.set(id, ticket);
    return ticket;
  }

  async list({ tenantId, userId, query = {} }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 10));

    let items = [...tickets.values()].filter((t) => t.tenantId === tenantId);
    if (userId) items = items.filter((t) => String(t.userId) === String(userId));
    if (query.status) items = items.filter((t) => t.status === query.status);
    if (query.category) items = items.filter((t) => t.category === query.category);

    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const total = items.length;
    const paged = items.slice((page - 1) * limit, page * limit);

    return {
      items: serializeList(paged),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: (page - 1) * limit + paged.length < total },
    };
  }

  async get({ tenantId, ticketId }) {
    const ticket = tickets.get(ticketId);
    if (!ticket || ticket.tenantId !== tenantId) throw notFound('Ticket not found', 'TICKET_NOT_FOUND');
    return ticket;
  }

  async addMessage({ tenantId, ticketId, userId, message, isStaff = false }) {
    const ticket = await this.get({ tenantId, ticketId });
    ticket.messages.push({
      sender: isStaff ? 'staff' : 'customer',
      userId,
      message,
      timestamp: new Date(),
    });
    if (isStaff && ticket.status === 'open') ticket.status = 'in_progress';
    ticket.updatedAt = new Date();
    return ticket;
  }

  async addNote({ tenantId, ticketId, staffId, note }) {
    const ticket = await this.get({ tenantId, ticketId });
    ticket.internalNotes.push({ staffId, note, timestamp: new Date() });
    ticket.updatedAt = new Date();
    return ticket;
  }

  async updateStatus({ tenantId, ticketId, status }) {
    if (!TICKET_STATUS.includes(status)) throw badRequest('Invalid status', 'INVALID_STATUS');
    const ticket = await this.get({ tenantId, ticketId });
    ticket.status = status;
    ticket.updatedAt = new Date();
    if (status === 'resolved') ticket.resolvedAt = new Date();
    if (status === 'closed') ticket.closedAt = new Date();
    return ticket;
  }

  async rate({ tenantId, ticketId, rating }) {
    if (rating < 1 || rating > 5) throw badRequest('Rating must be 1-5', 'INVALID_RATING');
    const ticket = await this.get({ tenantId, ticketId });
    ticket.satisfaction = rating;
    ticket.updatedAt = new Date();
    return ticket;
  }

  async stats({ tenantId }) {
    const items = [...tickets.values()].filter((t) => t.tenantId === tenantId);
    return {
      total: items.length,
      open: items.filter((t) => t.status === 'open').length,
      inProgress: items.filter((t) => t.status === 'in_progress').length,
      resolved: items.filter((t) => t.status === 'resolved').length,
      avgSatisfaction: items.filter((t) => t.satisfaction).reduce((s, t) => s + t.satisfaction, 0) / Math.max(1, items.filter((t) => t.satisfaction).length),
    };
  }
}

export default new SupportService();
