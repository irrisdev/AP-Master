using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AP_Master.Server.Migrations
{
    /// <inheritdoc />
    public partial class MergeComplaintsIntoTickets : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Category",
                table: "SupportTickets",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "Escalated",
                table: "SupportTickets",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "Reference",
                table: "SupportTickets",
                type: "TEXT",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "Severity",
                table: "SupportTickets",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Type",
                table: "SupportTickets",
                type: "TEXT",
                nullable: false,
                defaultValue: "");

            // Existing support tickets: keep the reference they were already shown (TKT-000042), and
            // take their type from the conversation that raised them.
            migrationBuilder.Sql("""
                UPDATE SupportTickets
                SET Reference = 'TKT-' || printf('%06d', Id),
                    Type = COALESCE(
                        (SELECT c.RequestType FROM Conversations c
                         WHERE c.Id = SupportTickets.ConversationId AND c.RequestType IN ('TechnicalSupport', 'ServiceIssue')),
                        'TechnicalSupport');
                """);

            // Complaints become tickets of type Complaint. Their statuses (Open, InProgress, Resolved, Closed)
            // and severities (Low, Medium, High) are all valid TicketStatus / TicketSeverity names.
            migrationBuilder.Sql("""
                INSERT INTO SupportTickets
                    (CustomerId, ConversationId, Description, Status, CreatedAt, UpdatedAt, Category, Escalated, Reference, Severity, Type)
                SELECT CustomerId, ConversationId, Description, Status, CreatedAt, UpdatedAt, Category, Escalated, Reference, Severity, 'Complaint'
                FROM Complaints
                ORDER BY Id;
                """);

            migrationBuilder.DropTable(
                name: "Complaints");

            migrationBuilder.CreateIndex(
                name: "IX_SupportTickets_Reference",
                table: "SupportTickets",
                column: "Reference",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Complaints",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    ConversationId = table.Column<int>(type: "INTEGER", nullable: true),
                    CustomerId = table.Column<int>(type: "INTEGER", nullable: false),
                    Category = table.Column<string>(type: "TEXT", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    Description = table.Column<string>(type: "TEXT", nullable: false),
                    Escalated = table.Column<bool>(type: "INTEGER", nullable: false),
                    Reference = table.Column<string>(type: "TEXT", nullable: false),
                    Severity = table.Column<string>(type: "TEXT", nullable: false),
                    Status = table.Column<string>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Complaints", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Complaints_Conversations_ConversationId",
                        column: x => x.ConversationId,
                        principalTable: "Conversations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_Complaints_Customers_CustomerId",
                        column: x => x.CustomerId,
                        principalTable: "Customers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Complaints_ConversationId",
                table: "Complaints",
                column: "ConversationId");

            migrationBuilder.CreateIndex(
                name: "IX_Complaints_CustomerId",
                table: "Complaints",
                column: "CustomerId");

            migrationBuilder.CreateIndex(
                name: "IX_Complaints_Reference",
                table: "Complaints",
                column: "Reference",
                unique: true);
            migrationBuilder.Sql("""
                INSERT INTO Complaints
                    (CustomerId, ConversationId, Category, CreatedAt, Description, Escalated, Reference, Severity, Status, UpdatedAt)
                SELECT CustomerId, ConversationId, COALESCE(Category, 'General'), CreatedAt, Description, Escalated, Reference,
                       COALESCE(Severity, 'Low'), CASE Status WHEN 'AwaitingTechnician' THEN 'Open' ELSE Status END, UpdatedAt
                FROM SupportTickets
                WHERE Type = 'Complaint'
                ORDER BY Id;

                DELETE FROM SupportTickets WHERE Type = 'Complaint';

                UPDATE SupportTickets SET Status = 'AwaitingTechnician' WHERE Status = 'Open';
                """);

            migrationBuilder.DropIndex(
                name: "IX_SupportTickets_Reference",
                table: "SupportTickets");

            migrationBuilder.DropColumn(
                name: "Category",
                table: "SupportTickets");

            migrationBuilder.DropColumn(
                name: "Escalated",
                table: "SupportTickets");

            migrationBuilder.DropColumn(
                name: "Reference",
                table: "SupportTickets");

            migrationBuilder.DropColumn(
                name: "Severity",
                table: "SupportTickets");

            migrationBuilder.DropColumn(
                name: "Type",
                table: "SupportTickets");
        }
    }
}
