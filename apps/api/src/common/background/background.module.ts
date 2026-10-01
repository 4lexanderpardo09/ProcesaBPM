import { Global, Module } from '@nestjs/common';
import { BackgroundTasks } from './background-tasks.js';

@Global()
@Module({ providers: [BackgroundTasks], exports: [BackgroundTasks] })
export class BackgroundModule {}
