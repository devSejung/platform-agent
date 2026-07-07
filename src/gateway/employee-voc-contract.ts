export const EMPLOYEE_VOC_PATH = "/employee/voc";

export type EmployeeVocRequest = {
  title: string;
  body: string;
};

export type EmployeeVocSuccessResponse = {
  ok: true;
  issueKey: string;
  issueUrl: string;
};

export type EmployeeVocFailureResponse = {
  ok: false;
  error: string;
};
