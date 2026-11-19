export async function notify(db, user, title, target, recipientIds) {
  const recipients = await db.user.findMany({ where: { role: 'DIREKTOR', isActive: true,
    id: { not: user.id, ...(recipientIds ? { in: recipientIds } : {}) } }, select: { id: true } });
  // Enforce the recipient rule at the write boundary as well as in the query.
  const otherDirectors = recipients.filter(recipient => recipient.id !== user.id);
  if (otherDirectors.length) await db.directorNotification.createMany({ data: otherDirectors.map(recipient => ({ userId: recipient.id, title, ...target })) });
}
