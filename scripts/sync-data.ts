import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function syncAllData() {
  console.log('=== SYNCING ALL DATA ===\n')

  const volunteers = await prisma.volunteer.findMany({
    include: {
      matches: {
        include: {
          sessions: true
        }
      }
    }
  })

  let fixedCount = 0

  for (const v of volunteers as any[]) {
    // Calculate actual values
    const actualCapacity = v.matches.filter((m: any) => ['accepted', 'active'].includes(m.status)).length
    const actualStudentsHelped = new Set(v.matches.filter((m: any) =>
      ['accepted', 'active', 'completed'].includes(m.status)
    ).map((m: any) => m.studentId)).size

    const totalMinutes = v.matches.flatMap((m: any) => m.sessions)
      .filter((s: any) => s.status === 'completed')
      .reduce((acc: number, s: any) => acc + (s.durationMinutes || 0), 0)
    const actualHours = Math.round(totalMinutes / 60 * 10) / 10

    // Check if update needed
    const needsUpdate =
      v.currentCapacity !== actualCapacity ||
      v.studentsHelped !== actualStudentsHelped ||
      v.totalHoursVolunteered !== actualHours

    if (needsUpdate) {
      await prisma.volunteer.update({
        where: { id: v.id },
        data: {
          currentCapacity: actualCapacity,
          studentsHelped: actualStudentsHelped,
          totalHoursVolunteered: actualHours
        }
      })
      console.log(`Fixed ${v.fullName}:`)
      if (v.currentCapacity !== actualCapacity) console.log(`  - capacity: ${v.currentCapacity} -> ${actualCapacity}`)
      if (v.studentsHelped !== actualStudentsHelped) console.log(`  - studentsHelped: ${v.studentsHelped} -> ${actualStudentsHelped}`)
      if (v.totalHoursVolunteered !== actualHours) console.log(`  - hours: ${v.totalHoursVolunteered} -> ${actualHours}`)
      fixedCount++
    } else {
      console.log(`${v.fullName}: OK`)
    }
  }

  console.log(`\nDone! Fixed ${fixedCount} volunteer(s)`)
  await prisma.$disconnect()
}

syncAllData()
