# Worker architecture

The worker service processes durable jobs from regional queues.

## Components

### Dispatcher

The dispatcher assigns each job to an available worker.

It records an assignment lease before publishing the job.

### Worker

The worker executes one job at a time.

Completed jobs are acknowledged after their result is stored.

### Reaper

The reaper returns expired assignments to the queue.

It runs once every minute in each region.

## Delivery guarantees

Jobs are delivered at least once.

Handlers must therefore be idempotent.

## Scaling

Workers scale from queue depth and processing latency.

The dispatcher remains active during worker scale-down.

## Failure handling

Poisoned jobs move to a dead-letter queue after five attempts.
