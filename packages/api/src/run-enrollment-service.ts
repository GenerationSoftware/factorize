import type { RunEnrollmentBinding, ConsumedRunEnrollment, RunEnrollmentRepository } from "./postgres/run-enrollment-repository";

export class RunEnrollmentUnavailableError extends Error {
  constructor() { super("Run enrollment is expired, revoked, disabled, or no longer active"); this.name = "RunEnrollmentUnavailableError"; }
}

/** Control path used by Factorize to issue a one-use token and authenticate its proxy redemption. */
export class RunEnrollmentService {
  constructor(private repository: RunEnrollmentRepository) {}

  async enroll(binding: RunEnrollmentBinding, expiresAt: Date, now = new Date()): Promise<{ enrollmentId: string; token: string; grantRevision: number }> {
    const enrollment = await this.repository.issue(binding, expiresAt, now);
    if (!enrollment) throw new RunEnrollmentUnavailableError();
    return enrollment;
  }

  async authenticate(token: string, binding: RunEnrollmentBinding, now = new Date()): Promise<ConsumedRunEnrollment> {
    const enrollment = await this.repository.consume(token, binding, now);
    if (!enrollment) throw new RunEnrollmentUnavailableError();
    return enrollment;
  }
}
