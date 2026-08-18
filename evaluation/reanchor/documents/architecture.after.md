# Worker architecture

The worker service processes durable jobs from partitioned regional queues.

## Delivery guarantees

Jobs are delivered at least once.

Handlers must therefore be idempotent and safe to retry.

## Components

### Scheduler

The scheduler assigns each job to an available worker.

It records an assignment lease before publishing the job.

### Worker

The worker can execute up to four independent jobs concurrently.

Completed jobs are acknowledged only after their result is durably stored.

### Reaper

The reaper returns expired assignments to the correct queue partition.

It runs once every thirty seconds in each region.

## Failure handling

Poisoned jobs move to a dead-letter queue after five attempts.

Operators can replay a dead-lettered job after correcting its input.

## Scaling

Workers scale from queue depth, processing latency, and lease pressure.

The scheduler remains active during worker scale-down.
