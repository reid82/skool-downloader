import fs from 'fs/promises';
import path from 'path';
import { ensureDir, fileExists } from '../utils/file-utils.js';
import { logger } from '../utils/logger.js';

export interface LessonState {
  id: string;
  moduleIndex: number;
  lessonIndex: number;
  moduleTitle: string;
  lessonTitle: string;
  videoUrl?: string;
  videoProvider?: string;
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'skipped';
  outputPath?: string;
  error?: string;
  attempts: number;
}

export interface CourseState {
  url: string;
  courseName: string;
  startedAt: string;
  lastUpdated: string;
  lessons: LessonState[];
}

export class ProgressTracker {
  private state: CourseState;
  private statePath: string;
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor(stateDir: string, courseSlug: string) {
    this.statePath = path.join(stateDir, `${courseSlug}-progress.json`);
    this.state = this.createEmptyState();
  }

  private createEmptyState(): CourseState {
    return {
      url: '',
      courseName: '',
      startedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      lessons: [],
    };
  }

  async load(): Promise<boolean> {
    try {
      if (await fileExists(this.statePath)) {
        const data = await fs.readFile(this.statePath, 'utf-8');
        this.state = JSON.parse(data);
        return true;
      }
    } catch (error) {
      logger.warn(`Could not load progress state: ${error}`);
    }
    return false;
  }

  async save(): Promise<void> {
    this.state.lastUpdated = new Date().toISOString();
    await ensureDir(path.dirname(this.statePath));
    await fs.writeFile(this.statePath, JSON.stringify(this.state, null, 2));
  }

  private scheduleSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => this.save(), 1000);
  }

  initialize(url: string, courseName: string): void {
    this.state.url = url;
    this.state.courseName = courseName;
    this.state.startedAt = new Date().toISOString();
  }

  addLesson(lesson: Omit<LessonState, 'status' | 'attempts'>): void {
    const existing = this.state.lessons.find((l) => l.id === lesson.id);
    if (!existing) {
      this.state.lessons.push({
        ...lesson,
        status: 'pending',
        attempts: 0,
      });
      this.scheduleSave();
    }
  }

  updateLesson(id: string, updates: Partial<LessonState>): void {
    const lesson = this.state.lessons.find((l) => l.id === id);
    if (lesson) {
      Object.assign(lesson, updates);
      this.scheduleSave();
    }
  }

  markStarted(id: string): void {
    this.updateLesson(id, {
      status: 'downloading',
      attempts: (this.getLesson(id)?.attempts || 0) + 1,
    });
  }

  markCompleted(id: string, outputPath: string): void {
    this.updateLesson(id, {
      status: 'completed',
      outputPath,
      error: undefined,
    });
  }

  markFailed(id: string, error: string): void {
    this.updateLesson(id, {
      status: 'failed',
      error,
    });
  }

  markSkipped(id: string, reason: string): void {
    this.updateLesson(id, {
      status: 'skipped',
      error: reason,
    });
  }

  getLesson(id: string): LessonState | undefined {
    return this.state.lessons.find((l) => l.id === id);
  }

  getPendingLessons(): LessonState[] {
    return this.state.lessons.filter(
      (l) => l.status === 'pending' || (l.status === 'failed' && l.attempts < 3)
    );
  }

  getStats(): {
    total: number;
    completed: number;
    failed: number;
    pending: number;
    skipped: number;
  } {
    const lessons = this.state.lessons;
    return {
      total: lessons.length,
      completed: lessons.filter((l) => l.status === 'completed').length,
      failed: lessons.filter((l) => l.status === 'failed').length,
      pending: lessons.filter((l) => l.status === 'pending').length,
      skipped: lessons.filter((l) => l.status === 'skipped').length,
    };
  }

  getState(): CourseState {
    return this.state;
  }

  hasExistingProgress(): boolean {
    return this.state.lessons.length > 0;
  }

  getCourseName(): string {
    return this.state.courseName;
  }
}
