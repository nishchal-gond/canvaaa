// Server-Sent Events (SSE) broadcaster for real-time display and admin updates

class SSEBroadcaster {
  constructor() {
    this.clients = new Set();
  }

  /**
   * Registers a new SSE client response stream.
   * @param {import('express').Response} res
   */
  addClient(res) {
    this.clients.add(res);

    // Remove client when connection closes
    res.on('close', () => {
      this.clients.delete(res);
    });
  }

  /**
   * Broadcasts a JSON event to all connected clients.
   * @param {string} event - Name of the event
   * @param {object} data - Payload to send
   */
  broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(payload);
      } catch (err) {
        console.error('Error writing to SSE client:', err);
        this.clients.delete(client);
      }
    }
  }

  getClientCount() {
    return this.clients.size;
  }
}

export const sseBroadcaster = new SSEBroadcaster();
