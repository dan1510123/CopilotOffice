import Phaser from 'phaser';
import { AgentConfig } from '../config/agents';
import { Depths } from '../config/depths';

interface ConversationMessage {
  role: 'user' | 'agent';
  content: string;
  timestamp: number;
}

interface AgentSession {
  agentId: string;
  messages: ConversationMessage[];
  startedAt: number;
}

export class DialogBox {
  private scene: Phaser.Scene;
  private container!: Phaser.GameObjects.Container;
  private background!: Phaser.GameObjects.Graphics;
  private npcNameText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private inputText!: Phaser.GameObjects.Text;
  private inputCursor!: Phaser.GameObjects.Text;
  private instructionText!: Phaser.GameObjects.Text;
  private sessionInfoText!: Phaser.GameObjects.Text;
  private currentInput: string = '';
  private isVisible: boolean = false;
  private currentAgent: AgentConfig | null = null;
  private onSendCallback: ((message: string) => void) | null = null;
  private onCloseCallback: (() => void) | null = null;
  private cursorBlink!: Phaser.Time.TimerEvent;
  
  // Persistent sessions per agent
  private agentSessions: Map<string, AgentSession> = new Map();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.create();
  }

  private create(): void {
    const width = this.scene.cameras.main.width;
    const height = this.scene.cameras.main.height;
    const boxHeight = 220;
    const boxY = height - boxHeight - 10;
    const boxX = 10;
    const boxWidth = width - 20;

    // Background
    this.background = this.scene.add.graphics();
    this.background.fillStyle(0x1a1a2e, 0.95);
    this.background.fillRoundedRect(boxX, boxY, boxWidth, boxHeight, 8);
    this.background.lineStyle(2, 0x4a4a8a, 1);
    this.background.strokeRoundedRect(boxX, boxY, boxWidth, boxHeight, 8);

    // NPC Name header
    this.npcNameText = this.scene.add.text(boxX + 15, boxY + 10, '', {
      font: 'bold 16px monospace',
      color: '#00ff88',
    });

    // Session info (message count, duration)
    this.sessionInfoText = this.scene.add.text(boxX + 15, boxY + 30, '', {
      font: '10px monospace',
      color: '#666688',
    });

    // Message display area (scrollable area)
    this.messageText = this.scene.add.text(boxX + 15, boxY + 48, '', {
      font: '13px monospace',
      color: '#ffffff',
      wordWrap: { width: boxWidth - 40 },
      lineSpacing: 4,
    });

    // Input area background
    const inputBg = this.scene.add.graphics();
    inputBg.fillStyle(0x0a0a1e, 0.8);
    inputBg.fillRoundedRect(boxX + 10, boxY + boxHeight - 50, boxWidth - 20, 35, 4);

    // Input text
    this.inputText = this.scene.add.text(boxX + 20, boxY + boxHeight - 42, '', {
      font: '14px monospace',
      color: '#88ff88',
      wordWrap: { width: boxWidth - 60 },
    });

    // Cursor
    this.inputCursor = this.scene.add.text(boxX + 20, boxY + boxHeight - 42, '_', {
      font: '14px monospace',
      color: '#88ff88',
    });

    // Instructions
    this.instructionText = this.scene.add.text(boxX + boxWidth - 200, boxY + 10, '[ESC] Leave  [ENTER] Send', {
      font: '10px monospace',
      color: '#888888',
    });

    // Create container
    this.container = this.scene.add.container(0, 0, [
      this.background,
      this.npcNameText,
      this.sessionInfoText,
      this.messageText,
      inputBg,
      this.inputText,
      this.inputCursor,
      this.instructionText,
    ]);
    
    this.container.setDepth(Depths.DIALOG);
    this.container.setVisible(false);

    // Cursor blink animation
    this.cursorBlink = this.scene.time.addEvent({
      delay: 500,
      callback: () => {
        this.inputCursor.setVisible(!this.inputCursor.visible);
      },
      loop: true,
    });

    // Set up keyboard input
    this.setupKeyboardInput();
  }

  private setupKeyboardInput(): void {
    this.scene.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
      if (!this.isVisible) return;

      if (event.key === 'Escape') {
        this.hide();
        return;
      }

      if (event.key === 'Enter') {
        if (this.currentInput.trim() && this.onSendCallback) {
          const message = this.currentInput.trim();
          // Add user message to session
          this.addMessageToSession('user', message);
          this.onSendCallback(message);
          this.currentInput = '';
          this.updateInputDisplay();
        }
        return;
      }

      if (event.key === 'Backspace') {
        this.currentInput = this.currentInput.slice(0, -1);
        this.updateInputDisplay();
        return;
      }

      // Add printable characters
      if (event.key.length === 1) {
        if (this.currentInput.length < 200) {
          this.currentInput += event.key;
          this.updateInputDisplay();
        }
      }
    });
  }

  private updateInputDisplay(): void {
    this.inputText.setText('> ' + this.currentInput);
    // Position cursor after text
    const textWidth = this.inputText.width;
    this.inputCursor.setX(this.inputText.x + textWidth + 2);
  }

  private getOrCreateSession(agentId: string): AgentSession {
    if (!this.agentSessions.has(agentId)) {
      this.agentSessions.set(agentId, {
        agentId,
        messages: [],
        startedAt: Date.now(),
      });
    }
    return this.agentSessions.get(agentId)!;
  }

  private addMessageToSession(role: 'user' | 'agent', content: string): void {
    if (!this.currentAgent) return;
    const session = this.getOrCreateSession(this.currentAgent.id);
    session.messages.push({
      role,
      content,
      timestamp: Date.now(),
    });
    this.updateSessionInfo();
  }

  private updateSessionInfo(): void {
    if (!this.currentAgent) return;
    const session = this.getOrCreateSession(this.currentAgent.id);
    const messageCount = session.messages.length;
    const duration = Math.floor((Date.now() - session.startedAt) / 1000 / 60);
    const durationText = duration < 1 ? 'just started' : `${duration}m session`;
    this.sessionInfoText.setText(`📝 ${messageCount} messages · ${durationText}`);
  }

  private renderConversation(): void {
    if (!this.currentAgent) return;
    const session = this.getOrCreateSession(this.currentAgent.id);
    
    if (session.messages.length === 0) {
      // Show greeting for new sessions
      this.messageText.setText(this.currentAgent.greeting);
      return;
    }

    // Show last few messages (fit in display area)
    const recentMessages = session.messages.slice(-6);
    const formattedMessages = recentMessages.map(msg => {
      const prefix = msg.role === 'user' ? '▶ You' : `◀ ${this.currentAgent!.name}`;
      return `${prefix}: ${msg.content}`;
    });
    
    this.messageText.setText(formattedMessages.join('\n\n'));
  }

  show(agent: AgentConfig, onSend: (message: string) => void, onClose: () => void): void {
    this.currentAgent = agent;
    this.onSendCallback = onSend;
    this.onCloseCallback = onClose;
    this.currentInput = '';
    
    // Get or create session for this agent
    const session = this.getOrCreateSession(agent.id);
    const isNewSession = session.messages.length === 0;
    
    this.npcNameText.setText(`💬 ${agent.name} - ${agent.description}`);
    this.updateSessionInfo();
    this.renderConversation();
    this.updateInputDisplay();
    
    // If returning to existing session, show welcome back message
    if (!isNewSession) {
      const lastMsg = session.messages[session.messages.length - 1];
      if (lastMsg.role === 'agent') {
        // Already showing conversation, nothing extra needed
      }
    }
    
    this.container.setVisible(true);
    this.isVisible = true;
  }

  hide(): void {
    this.container.setVisible(false);
    this.isVisible = false;
    // Don't clear currentAgent - session persists
    if (this.onCloseCallback) {
      this.onCloseCallback();
    }
    this.currentAgent = null;
  }

  showResponse(response: string): void {
    // Add agent response to session
    this.addMessageToSession('agent', response);
    this.renderConversation();
  }

  showTyping(): void {
    const currentText = this.messageText.text;
    this.messageText.setText(currentText + '\n\n⏳ typing...');
  }

  getIsVisible(): boolean {
    return this.isVisible;
  }

  // Get session for an agent (useful for external access)
  getSession(agentId: string): AgentSession | undefined {
    return this.agentSessions.get(agentId);
  }

  // Check if agent has an active session
  hasSession(agentId: string): boolean {
    const session = this.agentSessions.get(agentId);
    return session !== undefined && session.messages.length > 0;
  }

  // Clear a specific agent's session
  clearSession(agentId: string): void {
    this.agentSessions.delete(agentId);
  }

  // Clear all sessions
  clearAllSessions(): void {
    this.agentSessions.clear();
  }

  destroy(): void {
    this.cursorBlink.destroy();
    this.container.destroy();
  }
}
