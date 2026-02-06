/*
  Tool registry using an allow-list pattern.
  Only tools defined here can be called — the LLM can't invoke arbitrary functions.
  Each tool has a strict input schema that gets validated before execution.
*/

const TOOLS = {
  get_pricing: {
    name: 'get_pricing',
    description: 'Get pricing details for a Wanderon travel package/plan tier',
    parameters: {
      type: 'object',
      properties: {
        plan: {
          type: 'string',
          enum: ['backpacking', 'standard', 'premium', 'luxury'],
          description: 'The travel plan tier',
        },
      },
      required: ['plan'],
    },
    handler: (args) => {
      const pricing = {
        backpacking: {
          price: '₹8,999',
          duration: '3-4 days',
          includes: ['Hostel accommodation', 'Local transport', 'Guided treks'],
          excludes: ['Meals', 'Flights', 'Personal expenses'],
        },
        standard: {
          price: '₹14,999',
          duration: '4-5 days',
          includes: ['3-star hotel', 'All meals', 'Sightseeing', 'Local transport'],
          excludes: ['Flights', 'Adventure activities', 'Personal expenses'],
        },
        premium: {
          price: '₹24,999',
          duration: '5-6 days',
          includes: ['4-star hotel', 'All meals', 'Sightseeing', 'Adventure activities', 'Local transport'],
          excludes: ['Flights', 'Personal expenses'],
        },
        luxury: {
          price: '₹44,999',
          duration: '6-7 days',
          includes: ['Luxury resort', 'All meals', 'Private transport', 'All activities', 'Personal guide'],
          excludes: ['Flights'],
        },
      };
      return pricing[args.plan] || null;
    },
  },

  fetch_trip_policy: {
    name: 'fetch_trip_policy',
    description: 'Get booking and cancellation policies for a specific destination',
    parameters: {
      type: 'object',
      properties: {
        destination: {
          type: 'string',
          description: 'Destination name (e.g., Manali, Ladakh, Goa)',
        },
      },
      required: ['destination'],
    },
    handler: (args) => {
      const dest = args.destination.toLowerCase().trim();

      const base = {
        destination: args.destination,
        cancellation: '100% refund if cancelled 15+ days before departure. 50% for 7-14 days. No refund within 7 days.',
        booking_advance: '₹3,000 advance to confirm',
        group_size: '10-15 travelers',
        age_limit: '18-45 years',
        documents: ['Government ID', 'Medical fitness declaration'],
      };

      const specific = {
        ladakh: {
          altitude_warning: 'High altitude destination (3500m+). Medical certificate mandatory.',
          age_limit: '18-40 years',
          documents: ['Government ID', 'Medical fitness certificate', 'Inner Line Permit'],
        },
        spiti: {
          altitude_warning: 'High altitude. Medical certificate recommended.',
          road_conditions: 'Roads may close Nov-Apr due to snow.',
          documents: ['Government ID', 'Medical fitness declaration', 'Inner Line Permit'],
        },
        goa: {
          age_limit: '18-50 years',
          notes: 'Beach activities included. Swimwear recommended.',
        },
        manali: {
          winter_note: 'Dec-Feb trips include snow activities at additional cost.',
        },
        kashmir: {
          notes: 'Includes houseboat stay on Dal Lake for select packages.',
        },
        meghalaya: {
          fitness_level: 'Moderate — involves trekking to living root bridges.',
        },
      };

      return { ...base, ...(specific[dest] || {}) };
    },
  },

  get_lead_status: {
    name: 'get_lead_status',
    description: 'Check the status of a booking or lead by its ID',
    parameters: {
      type: 'object',
      properties: {
        lead_id: {
          type: 'string',
          pattern: '^WDR-[0-9]{4,6}$',
          description: 'Lead ID in format WDR-XXXX (e.g., WDR-1001)',
        },
      },
      required: ['lead_id'],
    },
    handler: (args) => {
      // mock DB — in production this would hit a real database
      const leads = {
        'WDR-1001': { status: 'confirmed', trip: 'Ladakh Adventure', departure: '2025-06-15', travelers: 3, payment: 'completed' },
        'WDR-1002': { status: 'pending_payment', trip: 'Goa Beach Retreat', departure: '2025-04-20', travelers: 2, payment: 'awaiting' },
        'WDR-1003': { status: 'cancelled', trip: 'Manali Snow Trek', departure: null, travelers: 1, payment: 'refunded' },
        'WDR-1004': { status: 'in_review', trip: 'Spiti Valley Circuit', departure: '2025-07-01', travelers: 4, payment: 'partial' },
      };

      if (!leads[args.lead_id]) {
        return { error: 'Lead not found', lead_id: args.lead_id };
      }
      return { lead_id: args.lead_id, ...leads[args.lead_id] };
    },
  },
};

const ALLOWED_TOOLS = Object.keys(TOOLS);

function getTool(name) {
  if (!ALLOWED_TOOLS.includes(name)) return null;
  return TOOLS[name];
}

function validateArgs(tool, args) {
  const schema = tool.parameters;
  const errors = [];

  for (const field of (schema.required || [])) {
    if (!(field in args)) {
      errors.push(`Missing required parameter: ${field}`);
    }
  }

  for (const [key, value] of Object.entries(args)) {
    const prop = schema.properties[key];
    if (!prop) {
      errors.push(`Unknown parameter: ${key}`);
      continue;
    }
    if (prop.enum && !prop.enum.includes(value)) {
      errors.push(`Invalid value for ${key}: "${value}". Expected one of: ${prop.enum.join(', ')}`);
    }
    if (prop.pattern && !new RegExp(prop.pattern).test(value)) {
      errors.push(`Invalid format for ${key}: "${value}". Expected pattern: ${prop.pattern}`);
    }
  }

  return errors;
}

function executeTool(name, args) {
  const tool = getTool(name);
  if (!tool) return { error: `Tool "${name}" is not in the allow-list` };

  const errors = validateArgs(tool, args);
  if (errors.length > 0) return { error: 'Validation failed', details: errors };

  return tool.handler(args);
}

function getToolDescriptions() {
  return ALLOWED_TOOLS.map(name => ({
    name: TOOLS[name].name,
    description: TOOLS[name].description,
    parameters: TOOLS[name].parameters,
  }));
}

module.exports = { getTool, executeTool, getToolDescriptions, ALLOWED_TOOLS };
