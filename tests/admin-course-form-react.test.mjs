import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('admin course add form is rendered by React from request events', () => {
  const html = `${readFileSync('admin.html', 'utf8')}\n${readFileSync('src/admin-app/admin-controller.js', 'utf8')}`;
  const main = readFileSync('src/admin-app/main.js', 'utf8');
  const form = readFileSync('src/admin-app/course-form.js', 'utf8');
  const adminAddCourse = html.match(/async function adminAddCourseFromReact\(detail\) \{[\s\S]*?let scEventId/)?.[0];

  assert.match(html, /id="adminCourseFormReactApp"/);
  assert.doesNotMatch(html, /id="adminCourseForm"|id="acName"|id="acLoc"|id="acUdisc"|id="acUdiscCourseId"/);
  assert.ok(adminAddCourse);
  assert.match(adminAddCourse, /adminApi\('\/admin\/courses', \{ method: 'POST', body \}\)/);
  assert.match(adminAddCourse, /gvdg:admin-course-create-result/);
  assert.match(adminAddCourse, /adminLoadCourses\(\)/);
  assert.doesNotMatch(adminAddCourse, /acName|acLoc|acUdisc|acUdiscCourseId|\$\('adminCourseForm'\)\.reset/);
  assert.doesNotMatch(html, /\$\('adminCourseForm'\)\.addEventListener\('submit', adminAddCourse\)/);
  assert.match(html, /gvdg:admin-course-create-request/);
  assert.match(html, /adminAddCourseFromReact\(event\.detail \|\| \{\}\)/);
  assert.match(main, /import \{ AdminCourseForm \} from "\.\/course-form\.js"/);
  assert.match(main, /const courseFormMount = document\.getElementById\("adminCourseFormReactApp"\)/);
  assert.match(main, /createRoot\(courseFormMount\)\.render\(h\(AdminCourseForm\)\)/);
  assert.match(form, /export function AdminCourseForm/);
  assert.match(form, /data-react-admin-course-form/);
  assert.match(form, /gvdg:admin-course-create-request/);
  assert.match(form, /gvdg:admin-course-create-result/);
  assert.match(form, /id: "adminCourseForm"/);
  assert.match(form, /id: "acName"/);
  assert.match(form, /id: "acLoc"/);
  assert.match(form, /id: "acUdisc"/);
  assert.match(form, /id: "acUdiscCourseId"/);
  assert.match(form, /udisc_course_id: udiscCourseId \|\| null/);
  assert.doesNotMatch(form, /innerHTML|insertAdjacentHTML|replaceChildren|document\.createElement|querySelector|classList|textContent\s*=|☰|✕|🔒|🌙|☀️|🏆|⚠|⏱|—/);
});
