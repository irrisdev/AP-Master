using AP_Master.Server.Models;
using Microsoft.EntityFrameworkCore;

namespace AP_Master.Server.Data;

public class TelegroupDbContext : DbContext
{

    public TelegroupDbContext(DbContextOptions<TelegroupDbContext> options) : base(options)
    {
    }

    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<Conversation> Conversations => Set<Conversation>();
    public DbSet<Message> Messages => Set<Message>();
    public DbSet<SupportTicket> SupportTickets => Set<SupportTicket>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // Customer
        modelBuilder.Entity<Customer>()
            .HasKey(c => c.Id);

        modelBuilder.Entity<Customer>()
            .Property(c => c.Name)
            .IsRequired()
            .HasMaxLength(100);

        modelBuilder.Entity<Customer>()
            .Property(c => c.Email)
            .IsRequired()
            .HasMaxLength(200);

        modelBuilder.Entity<Customer>()
            .HasIndex(c => c.Email)
            .IsUnique();

        // Customer -> Conversations
        modelBuilder.Entity<Conversation>()
            .HasOne(c => c.Customer)
            .WithMany(c => c.Conversations)
            .HasForeignKey(c => c.CustomerId)
            .OnDelete(DeleteBehavior.Cascade);

        // Conversation -> Messages
        modelBuilder.Entity<Message>()
            .HasOne(m => m.Conversation)
            .WithMany(c => c.Messages)
            .HasForeignKey(m => m.ConversationId)
            .OnDelete(DeleteBehavior.Cascade);

        // Customer -> SupportTickets
        modelBuilder.Entity<SupportTicket>()
            .HasOne(t => t.Customer)
            .WithMany(c => c.SupportTickets)
            .HasForeignKey(t => t.CustomerId)
            .OnDelete(DeleteBehavior.Cascade);

        // Conversation -> SupportTickets
        modelBuilder.Entity<SupportTicket>()
            .HasOne(t => t.Conversation)
            .WithMany(c => c.SupportTickets)
            .HasForeignKey(t => t.ConversationId)
            .OnDelete(DeleteBehavior.SetNull);

        // Ticket reference should be unique
        modelBuilder.Entity<SupportTicket>()
            .HasIndex(t => t.Reference)
            .IsUnique();

        // Store enums as strings for easier database inspection
        modelBuilder.Entity<Conversation>()
            .Property(c => c.RequestType)
            .HasConversion<string>();

        modelBuilder.Entity<Conversation>()
            .Property(c => c.Status)
            .HasConversion<string>();

        modelBuilder.Entity<SupportTicket>()
            .Property(t => t.Status)
            .HasConversion<string>();

        modelBuilder.Entity<SupportTicket>()
            .Property(t => t.Type)
            .HasConversion<string>();

        modelBuilder.Entity<SupportTicket>()
            .Property(t => t.Severity)
            .HasConversion<string>();
    }
}
