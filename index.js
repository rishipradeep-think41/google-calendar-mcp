import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { google } from "googleapis";
import * as dotenv from "dotenv";
import { join } from "path";
import { createStatelessServer } from "@smithery/sdk/server/stateless.js";

dotenv.config({ path: join(process.cwd(), ".env") });

function createMcpServer({ config }) {
  const CLIENT_ID = config?.CLIENT_ID || process.env.CLIENT_ID;
  const CLIENT_SECRET = config?.CLIENT_SECRET || process.env.CLIENT_SECRET;
  const REFRESH_TOKEN = config?.REFRESH_TOKEN || process.env.REFRESH_TOKEN;

  const server = new McpServer(
    {
      name: "google-calendar-server",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Set up OAuth2 client
  const auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
  auth.setCredentials({ refresh_token: REFRESH_TOKEN });

  // Initialize API clients
  const gmail = google.gmail({ version: "v1", auth: auth });
  const calendar = google.calendar({ version: "v3", auth: auth });

  // Error handling
  server.server.onerror = (error) => console.error("[MCP Error]", error);

  // Set up tool handlers
  server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "list_events",
        description: "List upcoming calendar events",
        inputSchema: {
          type: "object",
          properties: {
            maxResults: {
              type: "number",
              description: "Maximum number of events to return (default: 10)",
            },
            timeMin: {
              type: "string",
              description: "Start time in ISO format (default: now)",
            },
            timeMax: {
              type: "string",
              description: "End time in ISO format",
            },
          },
        },
      },
      {
        name: "create_event",
        description: "Create a new calendar event",
        inputSchema: {
          type: "object",
          properties: {
            summary: {
              type: "string",
              description: "Event title",
            },
            location: {
              type: "string",
              description: "Event location",
            },
            description: {
              type: "string",
              description: "Event description",
            },
            start: {
              type: "string",
              description: "Start time in ISO format",
            },
            end: {
              type: "string",
              description: "End time in ISO format",
            },
            attendees: {
              type: "array",
              items: { type: "string" },
              description: "List of attendee email addresses",
            },
          },
          required: ["summary", "start", "end"],
        },
      },
      {
        name: "update_event",
        description: "Update an existing calendar event",
        inputSchema: {
          type: "object",
          properties: {
            eventId: {
              type: "string",
              description: "Event ID to update",
            },
            summary: {
              type: "string",
              description: "New event title",
            },
            location: {
              type: "string",
              description: "New event location",
            },
            description: {
              type: "string",
              description: "New event description",
            },
            start: {
              type: "string",
              description: "New start time in ISO format",
            },
            end: {
              type: "string",
              description: "New end time in ISO format",
            },
            attendees: {
              type: "array",
              items: { type: "string" },
              description: "New list of attendee email addresses",
            },
          },
          required: ["eventId"],
        },
      },
      {
        name: "delete_event",
        description: "Delete a calendar event",
        inputSchema: {
          type: "object",
          properties: {
            eventId: {
              type: "string",
              description: "Event ID to delete",
            },
          },
          required: ["eventId"],
        },
      },
    ],
  }));
  server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    switch (request.params.name) {
      case "list_events":
        return await handleListEvents(request.params.arguments, calendar);
      case "create_event":
        return await handleCreateEvent(request.params.arguments, calendar);
      case "update_event":
        return await handleUpdateEvent(request.params.arguments, calendar);
      case "delete_event":
        return await handleDeleteEvent(request.params.arguments, calendar);
      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${request.params.name}`
        );
    }
  });
  return server;
}

async function handleCreateEvent(args, calendar) {
  try {
    const { summary, location, description, start, end, attendees = [] } = args;

    const event = {
      summary,
      location,
      description,
      start: {
        dateTime: start,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      end: {
        dateTime: end,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      attendees: attendees.map((email) => ({ email })),
    };

    const response = await calendar.events.insert({
      calendarId: "primary",
      requestBody: event,
    });

    return {
      content: [
        {
          type: "text",
          text: `Event created successfully. Event ID: ${response.data.id}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error creating event: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
}

async function handleUpdateEvent(args, calendar) {
  try {
    const { eventId, summary, location, description, start, end, attendees } =
      args;

    const event = {};
    if (summary) event.summary = summary;
    if (location) event.location = location;
    if (description) event.description = description;
    if (start) {
      event.start = {
        dateTime: start,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
    }
    if (end) {
      event.end = {
        dateTime: end,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
    }
    if (attendees) {
      event.attendees = attendees.map((email) => ({ email }));
    }

    const response = await calendar.events.patch({
      calendarId: "primary",
      eventId,
      requestBody: event,
    });

    return {
      content: [
        {
          type: "text",
          text: `Event updated successfully. Event ID: ${response.data.id}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error updating event: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
}

async function handleDeleteEvent(args, calendar) {
  try {
    const { eventId } = args;

    await calendar.events.delete({
      calendarId: "primary",
      eventId,
    });

    return {
      content: [
        {
          type: "text",
          text: `Event deleted successfully. Event ID: ${eventId}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error deleting event: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
}

async function handleListEvents(args, calendar) {
  try {
    const maxResults = args?.maxResults || 10;
    const timeMin = args?.timeMin || new Date().toISOString();
    const timeMax = args?.timeMax;

    const response = await calendar.events.list({
      calendarId: "primary",
      timeMin,
      timeMax,
      maxResults,
      singleEvents: true,
      orderBy: "startTime",
    });

    const events = response.data.items?.map((event) => ({
      id: event.id,
      summary: event.summary,
      start: event.start,
      end: event.end,
      location: event.location,
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(events, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error fetching calendar events: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
}

const { app } = createStatelessServer(createMcpServer);
const port = process.env.PORT || 8081;
app.listen(port, () => {
  console.log(`MCP server running on port ${port}`);
});
