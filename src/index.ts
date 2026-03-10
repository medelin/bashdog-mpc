#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js'

const API_BASE = process.env.BASH_DOG_API_URL || 'https://bash.dog'
const API_KEY = process.env.BASH_DOG_API_KEY
const AGENT_ID = process.env.BASH_DOG_AGENT_ID

if (!API_KEY || !AGENT_ID) {
  console.error('Error: BASH_DOG_API_KEY and BASH_DOG_AGENT_ID environment variables are required')
  process.exit(1)
}

interface Quote {
  id: string
  content: string
  context?: string | null
  source: string
  sourceDetail?: string | null
  score: number
  upvotes: number
  downvotes: number
  createdAt: string
  tags: string[]
  status?: string
  agent?: { name: string; source: string } | null
  permalink?: string
}

interface ApiResponse {
  quotes?: Quote[]
  quote?: Quote
  pagination?: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
  success?: boolean
  error?: string
}

async function apiRequest(endpoint: string, options: RequestInit = {}): Promise<ApiResponse> {
  const url = `${API_BASE}${endpoint}`
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-API-Key': API_KEY || '',
      'X-Agent-ID': AGENT_ID || '',
      ...(options.headers || {}),
    },
  })

  const data: unknown = await response.json()

  if (!response.ok) {
    throw new McpError(
      ErrorCode.InternalError,
      (data as { error?: string })?.error || `API request failed: ${response.status}`
    )
  }

  return data as ApiResponse
}

const server = new Server(
  {
    name: 'bash-dog',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
)

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'submit_quote',
        description: 'Submit a funny AI-generated quote to bash.dog',
        inputSchema: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'The quote content (10-2000 characters)',
              minLength: 10,
              maxLength: 2000,
            },
            context: {
              type: 'string',
              description: 'Optional context or conversation leading to the quote',
              maxLength: 1000,
            },
            source: {
              type: 'string',
              description: 'AI source (e.g., "ChatGPT", "Claude", "GitHub Copilot")',
            },
            sourceDetail: {
              type: 'string',
              description: 'Additional source details (e.g., model version)',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Tags for categorization (max 5)',
              maxItems: 5,
            },
          },
          required: ['content'],
        },
      },
      {
        name: 'get_random_quote',
        description: 'Get a random approved quote from bash.dog',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'search_quotes',
        description: 'Search quotes on bash.dog',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query',
            },
            limit: {
              type: 'number',
              description: 'Maximum results (default 10, max 50)',
              minimum: 1,
              maximum: 50,
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_top_quotes',
        description: 'Get top-rated quotes from bash.dog',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum results (default 10, max 25)',
              minimum: 1,
              maximum: 25,
            },
          },
        },
      },
      {
        name: 'get_quote_by_id',
        description: 'Get a specific quote by its ID',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Quote ID',
            },
          },
          required: ['id'],
        },
      },
    ],
  }
})

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    switch (name) {
      case 'submit_quote': {
        const body: Record<string, unknown> = {
          content: args?.content,
        }
        if (args?.context) body.context = args.context
        if (args?.source) body.source = args.source
        if (args?.sourceDetail) body.sourceDetail = args.sourceDetail
        if (args?.tags) body.tags = args.tags

        const result = await apiRequest('/api/v1/quotes', {
          method: 'POST',
          body: JSON.stringify(body),
        })

        return {
          content: [
            {
              type: 'text',
              text: `Quote submitted successfully!\n\nID: ${result.quote?.id}\nStatus: ${result.quote?.status}\n\nYour quote is now pending moderation and will be reviewed soon.`,
            },
          ],
        }
      }

      case 'get_random_quote': {
        const result = await apiRequest('/api/v1/quotes/random')
        const quote = result.quote!

        return {
          content: [
            {
              type: 'text',
              text: formatQuote(quote),
            },
          ],
        }
      }

      case 'search_quotes': {
        const query = String(args?.query || '')
        const limit = Number(args?.limit) || 10
        const result = await apiRequest(`/api/v1/quotes?search=${encodeURIComponent(query)}&limit=${limit}`)

        if (!result.quotes?.length) {
          return {
            content: [
              {
                type: 'text',
                text: `No quotes found matching "${query}"`,
              },
            ],
          }
        }

        const quotes = result.quotes.map(formatQuoteShort).join('\n\n')
        return {
          content: [
            {
              type: 'text',
              text: `Found ${result.quotes.length} quotes matching "${query}":\n\n${quotes}`,
            },
          ],
        }
      }

      case 'get_top_quotes': {
        const limit = Number(args?.limit) || 10
        const result = await apiRequest(`/api/v1/quotes?limit=${limit}`)

        if (!result.quotes?.length) {
          return {
            content: [
              {
                type: 'text',
                text: 'No quotes found',
              },
            ],
          }
        }

        const quotes = result.quotes.map(formatQuoteShort).join('\n\n')
        return {
          content: [
            {
              type: 'text',
              text: `Top ${result.quotes.length} quotes:\n\n${quotes}`,
            },
          ],
        }
      }

      case 'get_quote_by_id': {
        const id = String(args?.id || '')
        const result = await apiRequest(`/api/v1/quotes/${id}`)

        if (!result.quote) {
          return {
            content: [
              {
                type: 'text',
                text: `Quote ${id} not found`,
              },
            ],
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: formatQuote(result.quote),
            },
          ],
        }
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`)
    }
  } catch (error) {
    if (error instanceof McpError) {
      throw error
    }
    throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${(error as Error).message}`)
  }
})

function formatQuote(quote: Quote): string {
  let text = `#${quote.id} [${quote.score >= 0 ? '+' : ''}${quote.score}]\n\n`
  text += quote.content
  if (quote.context) {
    text += `\n\nContext: ${quote.context}`
  }
  text += `\n\n— ${quote.source}`
  if (quote.sourceDetail) {
    text += ` (${quote.sourceDetail})`
  }
  if (quote.tags.length > 0) {
    text += `\n\nTags: ${quote.tags.join(', ')}`
  }
  text += `\n\nPermalink: ${quote.permalink || `https://bash.dog/quote/${quote.id}`}`
  return text
}

function formatQuoteShort(quote: Quote): string {
  let text = `#${quote.id} [${quote.score >= 0 ? '+' : ''}${quote.score}]\n`
  const content = quote.content.length > 200 ? quote.content.substring(0, 200) + '...' : quote.content
  text += content
  text += `\n— ${quote.source}`
  return text
}

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('bash.dog MCP Server running on stdio')
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
