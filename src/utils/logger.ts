import ora, { Ora } from 'ora';
import chalk from 'chalk';

class Logger {
  private spinner: Ora | null = null;

  info(message: string): void {
    this.stopSpinner();
    console.log(chalk.blue('i'), message);
  }

  success(message: string): void {
    this.stopSpinner();
    console.log(chalk.green('✓'), message);
  }

  warn(message: string): void {
    this.stopSpinner();
    console.log(chalk.yellow('!'), message);
  }

  error(message: string): void {
    this.stopSpinner();
    console.log(chalk.red('✗'), message);
  }

  debug(message: string): void {
    if (process.env.DEBUG) {
      console.log(chalk.gray('  [debug]'), message);
    }
  }

  startSpinner(message: string): void {
    this.stopSpinner();
    this.spinner = ora(message).start();
  }

  updateSpinner(message: string): void {
    if (this.spinner) {
      this.spinner.text = message;
    }
  }

  succeedSpinner(message?: string): void {
    if (this.spinner) {
      this.spinner.succeed(message);
      this.spinner = null;
    }
  }

  failSpinner(message?: string): void {
    if (this.spinner) {
      this.spinner.fail(message);
      this.spinner = null;
    }
  }

  warnSpinner(message?: string): void {
    if (this.spinner) {
      this.spinner.warn(message);
      this.spinner = null;
    }
  }

  stopSpinner(): void {
    if (this.spinner) {
      this.spinner.stop();
      this.spinner = null;
    }
  }

  // Progress display for downloads
  progress(current: number, total: number, label: string): void {
    const percent = Math.round((current / total) * 100);
    const bar = this.progressBar(percent);
    this.updateSpinner(`${bar} ${percent}% - ${label}`);
  }

  private progressBar(percent: number): string {
    const filled = Math.round(percent / 5);
    const empty = 20 - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
  }
}

export const logger = new Logger();
