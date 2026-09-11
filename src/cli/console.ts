import readline from 'node:readline';

// Tiny console helpers for the setup wizard (stdout is fine here: the wizard
// is a separate binary, not the MCP stdio server).

export function print(msg = ''): void {
  console.log(msg);
}

export function hr(): void {
  console.log('─'.repeat(50));
}

export function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}
