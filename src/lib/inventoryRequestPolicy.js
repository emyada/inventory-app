export const employeeMayCreate=(role,policy)=>role==='admin'||(role==='staff'&&policy?.employee_requests_enabled===true);
