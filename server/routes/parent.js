'use strict';
/**
 * Parent API — `/api/parent/*`
 *
 * Kept separate from `/api/mobile/*` on purpose: that router is guarded for
 * staff and students, and a parent must never be able to record attendance,
 * file a request or reach the leaderboard. These routes are the only ones a
 * parent account can call, and every one of them is scoped to a child the
 * account is actually linked to.
 */
const express = require('express');
const db = require('../db');
const U = require('../util');
const auth = require('../auth');
const parent = require('../parent');

const router = express.Router();
router.use(auth.attachUser, auth.requireAuth, auth.requireRole('parent'));

/* ------------------------------ children ------------------------------ */
router.get('/children', (req, res) => {
  const kids = parent.childrenOf(req.user.id);
  if (!kids.length) {
    return U.ok(res, {
      items: [],
      note: 'Belum ada peserta didik yang terhubung dengan akun ini. Hubungi administrator sekolah.',
    });
  }
  return U.ok(res, { items: kids, count: kids.length });
});

/* ------------------------------ overview ------------------------------ */
/**
 * The whole picture for one child: school hours, after-school activities,
 * letters and school information.
 */
router.get('/overview', (req, res) => {
  const studentId = String(req.query.student_id || '').trim();
  if (!studentId) return U.fail(res, 'Peserta didik tidak ditentukan.');

  // The link is the authorisation: no link, no data.
  if (!parent.mayView(req.user.id, studentId)) {
    return U.fail(res, 'Peserta didik ini tidak terhubung dengan akun Anda.', 403);
  }
  const data = parent.overviewFor(req.user.id, studentId);
  if (!data) return U.fail(res, 'Peserta didik tidak ditemukan.', 404);
  return U.ok(res, data);
});

module.exports = router;
