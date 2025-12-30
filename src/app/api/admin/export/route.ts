import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyAccessToken } from '@/lib/auth'
import { cookies } from 'next/headers'
import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

interface Topic {
  keyword: string
  status: string
  assignedTo?: string
}

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('accessToken')?.value

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await verifyAccessToken(token)
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') // students, volunteers, matches
    const format = searchParams.get('format') // excel, pdf

    if (!type || !['students', 'volunteers', 'matches'].includes(type)) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }

    if (!format || !['excel', 'pdf'].includes(format)) {
      return NextResponse.json({ error: 'Invalid format' }, { status: 400 })
    }

    let data: Record<string, unknown>[] = []
    let filename = ''

    if (type === 'students') {
      const students = await prisma.student.findMany({
        include: {
          user: {
            select: {
              email: true,
              createdAt: true,
            },
          },
          matches: {
            select: {
              status: true,
              volunteer: {
                select: {
                  fullName: true,
                },
              },
              assignedSubjects: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      })

      data = students.map((s: any) => {
        const topics = (s.topicsNeedSupport as unknown as Topic[]) || []
        const activeMatches = s.matches.filter((m: any) =>
          ['email_sent', 'accepted', 'active'].includes(m.status)
        )

        return {
          'Full Name': s.fullName,
          'Email': s.user.email,
          'Age': s.age || '',
          'Gender': s.gender || '',
          'Phone Number': s.phoneNumber || '',
          'Alternative Contact': s.alternativeContact || '',
          'Current City': s.currentCity || '',
          'Current Country': s.currentCountry || '',
          'Area': s.area || '',
          'Original Location': s.originalLocation || '',
          'Cause': s.cause,
          'Fields of Study': s.fieldsOfStudy.join(', '),
          'Topics Need Support': topics.map((t: any) => t.keyword).join(', '),
          'Topics Status': topics.map((t: any) => `${t.keyword}: ${t.status}`).join('; '),
          'Original University': s.originalUniversity || '',
          'Current University': s.currentUniversity || '',
          'Credits Remaining': s.creditsRemaining || '',
          'Has Transcripts': s.hasTranscripts ? 'Yes' : 'No',
          'Preferred Language': s.preferredLanguage || '',
          'Languages Spoken': s.languagesSpoken?.join(', ') || '',
          'Hours Per Week Needed': s.hoursPerWeekNeeded || '',
          'Device Access Level': s.deviceAccessLevel || '',
          'Internet Access Level': s.internetAccessLevel || '',
          'Materials Access Level': s.materialsAccessLevel || '',
          'Special Needs': s.specialNeeds || '',
          'Educational Background': s.educationalBackground || '',
          'Career Goals': s.careerGoals || '',
          'Active Matches': activeMatches.length,
          'Matched Volunteers': activeMatches.map((m: any) => m.volunteer.fullName).join(', '),
          'Assigned Subjects': activeMatches.flatMap((m: any) => m.assignedSubjects).join(', '),
          'Registered At': new Date(s.user.createdAt).toLocaleDateString(),
          'Last Updated': new Date(s.updatedAt).toLocaleDateString(),
        }
      })
      filename = `students_backup_${new Date().toISOString().split('T')[0]}`
    } else if (type === 'volunteers') {
      const volunteers = await prisma.volunteer.findMany({
        include: {
          user: {
            select: {
              email: true,
              createdAt: true,
            },
          },
          matches: {
            select: {
              status: true,
              student: {
                select: {
                  fullName: true,
                },
              },
              assignedSubjects: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      })

      data = volunteers.map((v: any) => {
        const activeMatches = v.matches.filter((m: any) =>
          ['email_sent', 'accepted', 'active'].includes(m.status)
        )

        return {
          'Full Name': v.fullName,
          'Email': v.user.email,
          'Age': v.age || '',
          'Phone Number': v.phoneNumber || '',
          'City': v.city || '',
          'Country': v.country || '',
          'Area': v.area || '',
          'University Affiliation': v.universityAffiliation || '',
          'Causes': v.causes.join(', '),
          'Fields of Expertise': v.fieldsOfExpertise.join(', '),
          'Subjects Qualified': v.subjectsQualified.join(', '),
          'Languages Spoken': v.languagesSpoken?.join(', ') || '',
          'Preferred Language': v.preferredLanguage || '',
          'Online Teaching Experience': v.onlineTeachingExperience ? 'Yes' : 'No',
          'Diverse Background Experience': v.diverseBackgroundExperience ? 'Yes' : 'No',
          'Hours Per Week Available': v.hoursPerWeekAvailable || '',
          'Current Capacity': v.currentCapacity,
          'Max Capacity': v.maxCapacity,
          'Capacity Set By': v.capacitySetBy,
          'Is Available': v.isAvailable ? 'Yes' : 'No',
          'Additional Support Willing': v.additionalSupportWilling || '',
          'Bio': v.bio || '',
          'Rating': v.rating,
          'Total Hours Volunteered': v.totalHoursVolunteered,
          'Students Helped': v.studentsHelped,
          'Active Matches': activeMatches.length,
          'Matched Students': activeMatches.map((m: any) => m.student.fullName).join(', '),
          'Teaching Subjects': activeMatches.flatMap((m: any) => m.assignedSubjects).join(', '),
          'Registered At': new Date(v.user.createdAt).toLocaleDateString(),
          'Last Updated': new Date(v.updatedAt).toLocaleDateString(),
        }
      })
      filename = `volunteers_backup_${new Date().toISOString().split('T')[0]}`
    } else if (type === 'matches') {
      const matches = await prisma.match.findMany({
        include: {
          student: {
            select: {
              fullName: true,
              cause: true,
              fieldsOfStudy: true,
              topicsNeedSupport: true,
              phoneNumber: true,
              currentCity: true,
              currentCountry: true,
              preferredLanguage: true,
              user: {
                select: {
                  email: true,
                },
              },
            },
          },
          volunteer: {
            select: {
              fullName: true,
              fieldsOfExpertise: true,
              subjectsQualified: true,
              phoneNumber: true,
              city: true,
              country: true,
              preferredLanguage: true,
              user: {
                select: {
                  email: true,
                },
              },
            },
          },
          admin: {
            select: {
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      })

      data = matches.map((m: any) => {
        const reasons = Array.isArray(m.matchReasons) ? m.matchReasons : []
        const studentTopics = (m.student.topicsNeedSupport as unknown as Topic[]) || []
        return {
          'Match ID': m.id,
          'Status': m.status,
          'Student Name': m.student.fullName,
          'Student Email': m.student.user.email,
          'Student Phone': m.student.phoneNumber || '',
          'Student Cause': m.student.cause,
          'Student Fields': m.student.fieldsOfStudy.join(', '),
          'Student Topics': studentTopics.map((t: any) => t.keyword).join(', '),
          'Student Location': [m.student.currentCity, m.student.currentCountry].filter(Boolean).join(', '),
          'Student Language': m.student.preferredLanguage || '',
          'Volunteer Name': m.volunteer.fullName,
          'Volunteer Email': m.volunteer.user.email,
          'Volunteer Phone': m.volunteer.phoneNumber || '',
          'Volunteer Fields': m.volunteer.fieldsOfExpertise.join(', '),
          'Volunteer Subjects': m.volunteer.subjectsQualified.join(', '),
          'Volunteer Location': [m.volunteer.city, m.volunteer.country].filter(Boolean).join(', '),
          'Volunteer Language': m.volunteer.preferredLanguage || '',
          'Assigned Subjects': m.assignedSubjects.join(', '),
          'Match Score': m.matchScore,
          'Match Reasons': reasons.join('; '),
          'Auto Suggested': m.autoSuggested ? 'Yes' : 'No',
          'Email Sent At': m.emailSentAt ? new Date(m.emailSentAt).toLocaleDateString() : '',
          'Volunteer Responded At': m.volunteerRespondedAt ? new Date(m.volunteerRespondedAt).toLocaleDateString() : '',
          'Start Date': m.startDate ? new Date(m.startDate).toLocaleDateString() : '',
          'End Date': m.endDate ? new Date(m.endDate).toLocaleDateString() : '',
          'Created By': m.admin?.email || 'System',
          'Admin Notes': m.adminNotes || '',
          'Created At': new Date(m.createdAt).toLocaleDateString(),
          'Updated At': new Date(m.updatedAt).toLocaleDateString(),
        }
      })
      filename = `matches_backup_${new Date().toISOString().split('T')[0]}`
    }

    if (format === 'pdf') {
      // Generate PDF file with ALL data
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' }) // A3 for more space

      // Add title
      const title = type.charAt(0).toUpperCase() + type.slice(1) + ' Report (Complete Data)'
      doc.setFontSize(18)
      doc.text(title, 14, 15)

      // Add date
      doc.setFontSize(10)
      doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 22)

      // Use ALL columns
      const headers = Object.keys(data[0] || {})
      const rows = data.map((row: any) => headers.map((h: any) => {
        const value = String(row[h] || '')
        // Truncate very long values but keep more content
        return value.length > 60 ? value.substring(0, 57) + '...' : value
      }))

      // Add table with all data
      autoTable(doc, {
        head: [headers],
        body: rows,
        startY: 28,
        styles: { fontSize: 6, cellPadding: 1.5, overflow: 'linebreak' },
        headStyles: { fillColor: [59, 130, 246], textColor: 255, fontSize: 6 },
        alternateRowStyles: { fillColor: [245, 247, 250] },
        margin: { left: 5, right: 5 },
        tableWidth: 'auto',
      })

      // Add footer with total count
      const finalY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || 200
      doc.setFontSize(10)
      doc.text(`Total Records: ${data.length}`, 14, finalY + 10)

      const pdfBuffer = Buffer.from(doc.output('arraybuffer'))

      return new NextResponse(pdfBuffer, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${filename}.pdf"`,
        },
      })
    }

    // Generate Excel file
    const worksheet = XLSX.utils.json_to_sheet(data)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, type.charAt(0).toUpperCase() + type.slice(1))

    // Auto-size columns
    const colWidths = Object.keys(data[0] || {}).map((key: any) => ({
      wch: Math.max(
        key.length,
        ...data.map((row: any) => String(row[key] || '').length)
      ),
    }))
    worksheet['!cols'] = colWidths

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}.xlsx"`,
      },
    })
  } catch (error) {
    console.error('Error exporting data:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
