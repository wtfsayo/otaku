# @elizaos/plugin-eigenai

Advanced AI model integration plugin for ElizaOS that provides state-of-the-art language model capabilities through the EigenAI service.

## Overview

The EigenAI plugin extends ElizaOS with powerful AI capabilities including:
- Text generation (small and large models)
- Text embeddings
- Object generation with schema validation

## Installation

```bash
bun add @elizaos/plugin-eigenai
```

## Configuration

The plugin requires the following environment variables:

### Required
- `EIGENAI_API_KEY` or `OPENAI_API_KEY`: Your EigenAI API key

### Optional
- `EIGENAI_BASE_URL`: Custom API endpoint (defaults to `https://api.openai.com/v1`)
- `EIGENAI_SMALL_MODEL`: Model for small text generation (default: `gpt-5-nano`)
- `EIGENAI_LARGE_MODEL`: Model for large text generation (default: `gpt-5-mini`)
- `EIGENAI_EMBEDDING_MODEL`: Model for embeddings (default: `text-embedding-3-small`)
- `EIGENAI_EMBEDDING_API_KEY`: Separate API key for embeddings (optional)
- `EIGENAI_EMBEDDING_URL`: Separate endpoint for embeddings (optional)
- `EIGENAI_EMBEDDING_DIMENSIONS`: Embedding vector dimensions (default: `1536`)
- `EIGENAI_EXPERIMENTAL_TELEMETRY`: Enable telemetry (default: `false`)
- `EIGENAI_SEED`: Seed for reproducible outputs (default: `42`)

## Usage

### Basic Setup

```typescript
import { eigenAIPlugin } from '@elizaos/plugin-eigenai';
import { Agent } from '@elizaos/core';

const agent = new Agent({
  plugins: [eigenAIPlugin],
  // ... other configuration
});
```

### Using Models

The plugin provides various model types through the runtime:

```typescript
// Text generation
const text = await runtime.useModel(ModelType.TEXT_SMALL, {
  prompt: "Write a haiku about coding",
  temperature: 0.7,
  maxTokens: 100
});

// Generate embeddings
const embedding = await runtime.useModel(ModelType.TEXT_EMBEDDING, {
  text: "Text to embed"
});

// Object generation with schema
const object = await runtime.useModel(ModelType.OBJECT_SMALL, {
  prompt: "Generate a user profile",
  schema: {
    name: { type: "string" },
    age: { type: "number" },
    interests: { type: "array", items: { type: "string" } }
  }
});
```

## Features

### Multi-Model Support
- Supports both small and large language models for different use cases
- Automatic model selection based on task requirements
- Configurable model names for flexibility

### Advanced Text Processing
- Support for different embedding dimensions
- Configurable temperature, frequency penalty, and presence penalty


### Developer Features
- Comprehensive error handling with JSON repair functionality
- Usage tracking and telemetry
- Seed-based reproducible outputs
- Test suite for all major functions

## Testing

The plugin includes a comprehensive test suite:

```bash
bun test
```

Test coverage includes:
- API key validation
- Text generation (small and large models)
- Embedding generation

## Development

### Building

```bash
bun run build
```

### Development Mode

```bash
bun run dev
```

### Linting

```bash
bun run lint
```

## License

MIT

## Contributing

Contributions are welcome! Please see the main ElizaOS repository for contribution guidelines.

## Support

For issues and questions, please visit the [ElizaOS GitHub repository](https://github.com/elizaos/eliza).
