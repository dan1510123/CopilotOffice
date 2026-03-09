export interface TaskAssignment {
  agentId: string;
  title: string;
  description: string;
  prompt: string;
}

export interface MeetingPlan {
  plan: string;
  tasks: TaskAssignment[];
}

export interface FleetStatus {
  agentId: string;
  state: 'pending' | 'starting' | 'working' | 'done' | 'failed';
  taskTitle: string;
}
