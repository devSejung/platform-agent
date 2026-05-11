import { html, type TemplateResult } from "lit";

export type EmployeeCrabMascotPhase =
  | "idle"
  | "sending"
  | "waiting"
  | "streaming"
  | "tool"
  | "compacting"
  | "retrying"
  | "attention"
  | "queued";

const EMPLOYEE_CRAB_PATH = `
  M 307 282
  L 307 339
  L 250 341
  L 250 511
  L 306 511
  L 307 571
  L 360 573
  L 360 678
  L 308 680
  L 308 783
  L 360 784
  L 360 841
  L 308 842
  L 308 969
  L 360 969
  L 360 912
  L 404 911
  L 405 871
  L 448 871
  L 449 912
  L 515 912
  L 517 853
  L 738 853
  L 740 912
  L 806 912
  L 807 871
  L 850 871
  L 852 912
  L 895 912
  L 895 969
  L 947 970
  L 947 842
  L 895 841
  L 895 784
  L 947 783
  L 947 679
  L 895 678
  L 895 573
  L 948 571
  L 949 511
  L 1004 511
  L 1004 340
  L 947 339
  L 947 282
  L 860 282
  L 858 412
  L 806 411
  L 805 340
  L 739 341
  L 739 510
  L 792 512
  L 792 572
  L 835 572
  L 835 612
  L 420 612
  L 420 572
  L 463 572
  L 463 512
  L 515 511
  L 516 341
  L 450 340
  L 449 411
  L 396 412
  L 396 283
  Z
  M 701 673
  L 739 674
  L 738 747
  L 700 746
  Z
  M 517 673
  L 555 674
  L 554 747
  L 516 746
  Z
`;

export function renderEmployeeCrabMascot(phase: EmployeeCrabMascotPhase = "idle"): TemplateResult {
  return html`
    <span class="employee-crab-mascot-wrap" data-phase=${phase} aria-hidden="true">
      <span class="employee-crab-mascot__halo"></span>
      <span class="employee-crab-mascot__spark employee-crab-mascot__spark--a"></span>
      <span class="employee-crab-mascot__spark employee-crab-mascot__spark--b"></span>
      <span class="employee-crab-mascot__tool"></span>
      <span class="employee-crab-mascot__dot employee-crab-mascot__dot--a"></span>
      <span class="employee-crab-mascot__dot employee-crab-mascot__dot--b"></span>
      <svg class="employee-crab-mascot" viewBox="230 250 795 750" focusable="false">
        <path
          class="employee-crab-mascot__body"
          fill="currentColor"
          fill-rule="evenodd"
          d=${EMPLOYEE_CRAB_PATH}
        ></path>
      </svg>
    </span>
  `;
}
